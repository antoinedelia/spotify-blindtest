import React, { useState, useEffect, useRef } from 'react';
import './App.css';

// Configuration
const CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID;
const REDIRECT_URI = import.meta.env.VITE_REDIRECT_URI;
const SCOPES = import.meta.env.VITE_SCOPES;
const QUIZ_DURATION = Number(import.meta.env.VITE_QUIZ_DURATION); // Seconds per question
const FEEDBACK_DELAY = Number(import.meta.env.VITE_FEEDBACK_DELAY); // Milliseconds to show feedback
const CACHE_DURATION = Number(import.meta.env.VITE_CACHE_DURATION); // 1 day
const TRACK_MIN_DURATION = Number(import.meta.env.VITE_TRACK_MIN_DURATION); // 30 seconds
const PLAYER_VOLUME = Number(import.meta.env.VITE_PLAYER_VOLUME) || 0.5;

// Centralized Spotify API URLs for clarity
const SPOTIFY_API = {
  auth: 'https://accounts.spotify.com/authorize',
  me: 'https://api.spotify.com/v1/me',
  tracks: 'https://api.spotify.com/v1/me/tracks',
  player: 'https://api.spotify.com/v1/me/player',
};


function App() {
  // Core State
  const [accessToken, setAccessToken] = useState(null);
  const [user, setUser] = useState(null);
  const [player, setPlayer] = useState(null);
  const [deviceId, setDeviceId] = useState(null);
  const [sdkReady, setSdkReady] = useState(false);

  // Game State
  const [likedSongs, setLikedSongs] = useState([]);
  const [quizSongs, setQuizSongs] = useState([]);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [score, setScore] = useState(0);
  const [options, setOptions] = useState([]);
  const [gameState, setGameState] = useState('login'); // login, loading, ready, quiz, results

  // Improved quiz experience State
  const [timeLeft, setTimeLeft] = useState(QUIZ_DURATION);
  const [answered, setAnswered] = useState(false);
  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const timerIntervalRef = useRef(null);
  const songTimeoutRef = useRef(null);

  const [pointsGained, setPointsGained] = useState(0);
  const [combo, setCombo] = useState(0);
  const [showComboBreak, setShowComboBreak] = useState(false);
  const [highScore, setHighScore] = useState(0);

  const [totalLikedSongs, setTotalLikedSongs] = useState(0);

  const [showCompatibilityWarning, setShowCompatibilityWarning] = useState(false);

  const getComboMultiplier = (currentCombo) => {
    if (currentCombo >= 6) return 2.0;
    if (currentCombo >= 4) return 1.5;
    if (currentCombo >= 2) return 1.2;
    return 1.0;
  };

  // --- BROWSER DETECTION ---
  useEffect(() => {
    const userAgent = navigator.userAgent.toLowerCase();
    // Check for both 'android' and 'firefox' in the user agent string
    // Firefox for Android appears to not be working properly due to Encrypted Media Extensions (EME)
    const isFirefoxOnAndroid = userAgent.includes('android') && userAgent.includes('firefox');

    if (isFirefoxOnAndroid) {
      setShowCompatibilityWarning(true);
    }
  }, []);

  // --- Hooks for Authentication and SDK setup ---
  useEffect(() => {
    const hash = window.location.hash;
    let token = window.localStorage.getItem('spotify_access_token');
    if (!token && hash) {
      token = new URLSearchParams(hash.substring(1)).get('access_token');
      window.location.hash = '';
      window.localStorage.setItem('spotify_access_token', token);
    }
    setAccessToken(token);
  }, []);

  useEffect(() => {
    if (accessToken) {
      window.onSpotifyWebPlaybackSDKReady = () => setSdkReady(true);
      if (!document.querySelector('script[src="https://sdk.scdn.co/spotify-player.js"]')) {
        const script = document.createElement('script');
        script.src = 'https://sdk.scdn.co/spotify-player.js';
        script.async = true;
        document.body.appendChild(script);
      } else if (window.Spotify) {
        setSdkReady(true);
      }
    }
  }, [accessToken]);

  useEffect(() => {
    if (sdkReady && accessToken) {
      const spotifyPlayer = new window.Spotify.Player({
        name: 'Spotify Blindtest',
        getOAuthToken: cb => { cb(accessToken); },
        volume: PLAYER_VOLUME
      });
      spotifyPlayer.addListener('ready', ({ device_id }) => {
        setDeviceId(device_id);
        setGameState('loading');
      });
      spotifyPlayer.addListener('not_ready', ({ device_id }) => console.log('Device ID has gone offline', device_id));
      spotifyPlayer.addListener('authentication_error', ({ message }) => { console.error(message); handleLogout(); });
      spotifyPlayer.connect().then(success => success && console.log("Player connected!"));
      setPlayer(spotifyPlayer);
      return () => spotifyPlayer.disconnect();
    }
  }, [sdkReady, accessToken]);

  // --- OPTIMIZED PARALLEL DATA FETCHING ---
  useEffect(() => {
    // We need a function we can call for both initial load and force refresh
    const fetchAllData = async (forceRefresh = false) => {
      // Don't do anything until we have the device ID and token
      if (!deviceId || !accessToken) return;

      try {
        // We always need the user's profile to get their ID for the cache key
        const userResponse = await fetch(SPOTIFY_API.me, { headers: { 'Authorization': `Bearer ${accessToken}` } });
        if (!userResponse.ok) throw new Error('Failed to fetch user');
        const userData = await userResponse.json();
        setUser(userData);

        const cacheKey = `blindtest_song_cache_${userData.id}`;

        // --- Step 1: Check for a fresh cache ---
        if (!forceRefresh) {
          const cachedItem = localStorage.getItem(cacheKey);
          if (cachedItem) {
            const cachedData = JSON.parse(cachedItem);
            if (Date.now() - cachedData.timestamp < CACHE_DURATION) {
              console.log("Loading songs from local cache.");
              setLikedSongs(cachedData.songs);
              setTotalLikedSongs(cachedData.total);
              const storedHighScore = parseInt(localStorage.getItem(`blindtest_highscore_${userData.id}`), 10) || 0;
              setHighScore(storedHighScore);
              setGameState('ready');
              return; // Success! No need to fetch from API.
            }
          }
        }

        // --- Step 2: If no fresh cache, fetch from API ---
        console.log("Cache empty, stale, or refresh forced. Fetching from Spotify API...");
        setGameState('loading');

        // Get total track count
        const initialTracksUrl = new URL(SPOTIFY_API.tracks);
        initialTracksUrl.searchParams.append('limit', 1);
        const initialResponse = await fetch(initialTracksUrl, { headers: { 'Authorization': `Bearer ${accessToken}` } });
        if (!initialResponse.ok) throw new Error('Failed to fetch initial track count');
        const initialData = await initialResponse.json();
        const totalTracks = initialData.total;
        setTotalLikedSongs(totalTracks);

        // --- THIS IS THE MISSING LOGIC TO RESTORE ---
        const limit = 50;
        const fields = 'items(track(id,name,uri,duration_ms,artists(name),album(images),is_playable))';
        const promises = [];
        for (let offset = 0; offset < totalTracks; offset += limit) {
          const url = new URL(SPOTIFY_API.tracks);
          url.searchParams.append('limit', limit);
          url.searchParams.append('offset', offset);
          url.searchParams.append('fields', fields);
          promises.push(fetch(url, { headers: { 'Authorization': `Bearer ${accessToken}` } }));
        }
        const responses = await Promise.all(promises);
        for (const res of responses) {
          if (!res.ok) throw new Error(`A fetch request failed with status: ${res.status}`);
        }
        const jsonPromises = responses.map(res => res.json());
        const paginatedResults = await Promise.all(jsonPromises);
        // --- END OF MISSING LOGIC ---

        const tracks = paginatedResults.flatMap(page => page.items);
        const filteredTracks = tracks.map(item => item.track).filter(track => track && track.duration_ms >= TRACK_MIN_DURATION && track.is_playable);

        const skippedSongs = tracks.map(item => item.track).filter(track => track && (track.duration_ms < TRACK_MIN_DURATION || !track.is_playable));

        if (skippedSongs.length > 0) {
          console.groupCollapsed(`[Debug] Skipped ${skippedSongs.length} track(s)`);
          skippedSongs.forEach(track => {
            console.debug(`- ${track.name} by ${track.artists.map(a => a.name).join(', ')}`);
          });
          console.groupEnd();
        }

        if (filteredTracks.length < 10) {
          const minDurationInSeconds = TRACK_MIN_DURATION / 1000;
          alert(`You need at least 10 liked songs (longer than ${minDurationInSeconds}s) to play.`);
          handleLogout();
          return;
        }

        // --- Step 3: Save the fresh data to the cache ---
        const currentHighScore = parseInt(localStorage.getItem(`blindtest_highscore_${userData.id}`), 10) || 0;
        const cacheData = {
          songs: filteredTracks,
          total: totalTracks,
          timestamp: Date.now()
        };
        localStorage.setItem(cacheKey, JSON.stringify(cacheData));

        setLikedSongs(filteredTracks);
        setHighScore(currentHighScore);
        setGameState('ready');

      } catch (error) {
        console.error("Error fetching data:", error);
        handleLogout();
      }
    };

    fetchAllData();

  }, [deviceId, accessToken]);

  // Effect for the countdown timer
  useEffect(() => {
    if (gameState === 'quiz' && !answered) {
      timerIntervalRef.current = setInterval(() => {
        setTimeLeft(prevTime => {
          if (prevTime <= 1) { clearInterval(timerIntervalRef.current); handleAnswer(null); return 0; }
          return prevTime - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timerIntervalRef.current);
  }, [gameState, answered, currentQuestion]);

  useEffect(() => {
    // We only care about what happens when the game state becomes 'results'
    if (gameState === 'results') {
      // At this point, the 'score' state is guaranteed to be the final score.
      if (score > highScore) {
        setHighScore(score);
        // Ensure the user object is loaded before trying to use its id
        if (user) {
          localStorage.setItem(`blindtest_highscore_${user.id}`, score);
        }
      }
    }
    // This effect depends on these values
  }, [gameState, score, highScore, user]);


  // --- CORE & RENDER FUNCTIONS (FULLY IMPLEMENTED) ---

  const handleLogin = async () => {
    const generateRandomString = (length) => {
      const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      const values = crypto.getRandomValues(new Uint8Array(length));
      return values.reduce((acc, x) => acc + possible[x % possible.length], "");
    };
    const sha256 = async (plain) => {
      const encoder = new TextEncoder();
      const data = encoder.encode(plain);
      return window.crypto.subtle.digest('SHA-256', data);
    };
    const base64encode = (input) => {
      return btoa(String.fromCharCode(...new Uint8Array(input)))
        .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    };
    const codeVerifier = generateRandomString(64);
    window.localStorage.setItem('code_verifier', codeVerifier);
    const hashed = await sha256(codeVerifier);
    const codeChallenge = base64encode(hashed);
    const authUrl = new URL(SPOTIFY_API.auth);
    authUrl.search = new URLSearchParams({
      response_type: 'token',
      client_id: CLIENT_ID,
      scope: SCOPES,
      redirect_uri: REDIRECT_URI,
      code_challenge_method: 'S256',
      code_challenge: codeChallenge,
    }).toString();
    window.location.href = authUrl.toString();
  };

  const fadeOutAndStop = async (duration = 10000) => {
    // Safety check to ensure the player is available
    if (!player) return;

    const intervalTime = 100; // Update volume every 100ms for a smooth fade
    const steps = duration / intervalTime;

    try {
      // The player.getVolume() function returns a Promise
      const initialVolume = await player.getVolume();

      // If it's already silent, just pause it and we're done.
      if (initialVolume === 0) {
        player.pause();
        return;
      }

      const volumeDecrement = initialVolume / steps;
      let currentVolume = initialVolume;

      const fadeInterval = setInterval(() => {
        currentVolume -= volumeDecrement;

        if (currentVolume > 0) {
          player.setVolume(currentVolume).catch(e => {
            console.error("Error setting volume during fade:", e);
            clearInterval(fadeInterval); // Stop if there's an error
          });
        } else {
          // Fade is complete
          clearInterval(fadeInterval);
          player.setVolume(0); // Ensure it's exactly 0
          player.pause();      // Finally, pause the player
        }
      }, intervalTime);

    } catch (e) {
      console.error("Could not get initial volume for fade out. Pausing immediately.", e);
      // As a fallback, just pause the music if we can't get the volume.
      player.pause();
    }
  };

  const handleLogout = () => {
    if (player) player.disconnect();
    window.localStorage.removeItem('spotify_access_token');
    window.localStorage.removeItem('code_verifier');
    window.location.href = REDIRECT_URI;
  };

  // Using the Fisher-Yates Shuffle Algorithm
  const shuffleArray = (array) => {
    // Create a copy of the array to avoid modifying the original
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
      // Pick a random index from 0 to i (inclusive)
      const j = Math.floor(Math.random() * (i + 1));
      // Swap the elements at position i and j
      [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
    }
    return newArray;
  };

  const startQuiz = () => {
    if (player) {
      // First, activate the player element. This is crucial for mobile browsers
      // to allow playback that isn't directly inside a click event.
      player.activateElement().catch(err => {
        console.error('Failed to activate player for autoplay:', err);
        // You could optionally alert the user if this fails, but for now, we'll just log it.
      });

      // Then, reset the volume for the new quiz.
      player.setVolume(PLAYER_VOLUME).catch(e => console.error("Error resetting volume:", e));
    }

    const songs = likedSongs;
    const shuffled = shuffleArray(songs);
    const selectedSongs = shuffled.slice(0, 10);
    setQuizSongs(selectedSongs);
    setCurrentQuestion(0);
    setScore(0);
    setCombo(0);
    setGameState('quiz');
    loadQuestion(0, selectedSongs, songs);
  };

  const loadQuestion = (questionIndex, currentQuizSongs, allLikedSongs) => {
    setPointsGained(0);
    setAnswered(false);
    setSelectedAnswer(null);
    setTimeLeft(QUIZ_DURATION);
    const currentSong = currentQuizSongs[questionIndex];
    const otherSongs = shuffleArray(
      allLikedSongs.filter(s => s.id !== currentSong.id)
    ).slice(0, 3);
    const answerOptions = shuffleArray([currentSong, ...otherSongs]);
    setOptions(answerOptions);
    playSong(currentSong.uri, currentSong.duration_ms);
  };

  const playSong = (uri, duration_ms) => {
    if (!deviceId) return;
    if (songTimeoutRef.current) clearTimeout(songTimeoutRef.current);
    const playUrl = `${SPOTIFY_API.player}/play?device_id=${deviceId}`;
    fetch(playUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
      body: JSON.stringify({
        uris: [uri],
        position_ms: Math.floor(Math.random() * (duration_ms - (QUIZ_DURATION * 1000)))
      })
    });
    songTimeoutRef.current = setTimeout(() => {
      // Player failed to guess in time
      // if (player) player.pause();
    }, QUIZ_DURATION * 1000);
  };

  const handleAnswer = (selectedSong) => {
    if (answered) return;

    setAnswered(true);
    setSelectedAnswer(selectedSong);
    clearInterval(timerIntervalRef.current);
    clearTimeout(songTimeoutRef.current);

    if (selectedSong && selectedSong.id === quizSongs[currentQuestion].id) {
      // ... (The entire logic for calculating points is UNCHANGED) ...
      const multiplier = getComboMultiplier(combo);
      let basePoints = 50 + (timeLeft * 7);
      if (timeLeft >= 13) { basePoints += 50; }
      const finalPoints = Math.round(basePoints * multiplier);
      setScore(score + finalPoints);
      setPointsGained(finalPoints);
      setCombo(prevCombo => prevCombo + 1);
    } else {
      if (combo > 1) {
        setShowComboBreak(true);
        setTimeout(() => { setShowComboBreak(false); }, 1000);
      }
      setCombo(0);
    }

    setTimeout(() => {
      const nextQuestion = currentQuestion + 1;
      if (nextQuestion < quizSongs.length) {
        setCurrentQuestion(nextQuestion);
        loadQuestion(nextQuestion, quizSongs, likedSongs);
      } else {
        // The quiz is over. Just change the game state.
        // The new useEffect will handle the high score logic.
        fadeOutAndStop(10000);
        setGameState('results');
      }
    }, FEEDBACK_DELAY);
  };

  const getButtonClassName = (song) => {
    if (!answered) return "option-btn";
    const correctSongId = quizSongs[currentQuestion].id;
    if (song.id === correctSongId) return "option-btn correct";
    if (song.id === selectedAnswer?.id) return "option-btn incorrect";
    return "option-btn";
  };

  const restartQuiz = () => startQuiz();

  const renderContent = () => {
    if (!accessToken) {
      return (
        <div>
          <h1>Spotify Blindtest</h1>
          <p>Test your knowledge on your own liked songs!</p>
          <button onClick={handleLogin} className="login-btn">Login with Spotify</button>
        </div>
      );
    }
    switch (gameState) {
      case 'loading': return <div><h1>Loading Your Music...</h1><p>Fetching liked songs. Please wait.</p></div>;
      case 'ready':
        const handleForceRefresh = () => {
          // This is a bit of a workaround to re-trigger the fetch effect.
          // A better approach would be to lift the fetchAllData function, but this works.
          // For simplicity, we can just clear the cache and reload the page.
          const userCacheKey = `blindtest_song_cache_${user.id}`;
          localStorage.removeItem(userCacheKey);
          window.location.reload();
        };
        return (
          <div>
            <h1>Ready to Play?</h1>
            {user && <p>Welcome, {user.display_name}!</p>}
            <p>We've found <b>{totalLikedSongs}</b> of your liked songs.</p>
            <p>Click below to start the quiz.</p>
            <button onClick={startQuiz} className="quiz-btn">Start Quiz</button>

            {/* --- NEW: Button to force a refresh --- */}
            <button onClick={handleForceRefresh} className="secondary-btn">
              Force Refresh Songs
            </button>
          </div>
        );
      case 'quiz':
        const currentMultiplier = getComboMultiplier(combo);

        let comboClassName = "combo-indicator";
        if (currentMultiplier >= 2.0) {
          comboClassName += " combo-max"; // Red for 2.0x
        } else if (currentMultiplier >= 1.5) {
          comboClassName += " combo-hot"; // Orange for 1.5x
        }

        return (
          <div className="quiz-container">
            <div className="question-counter">Song {currentQuestion + 1} / {quizSongs.length}</div>
            {/* --- UPDATE: New container for score and points indicator --- */}
            <div className="score-container">
              <div className="score-wrapper">
                <div className="score">Score: {score}</div>
                {pointsGained > 0 && (
                  <div className="points-gained">
                    +{pointsGained}
                  </div>
                )}
              </div>
            </div>
            <div className="combo-display-area">
              {/* The active combo multiplier */}
              {currentMultiplier > 1.0 && (
                <div
                  // --- NEW: The 'key' forces a re-render and re-animation on change ---
                  key={currentMultiplier}
                  className={comboClassName}
                >
                  {currentMultiplier.toFixed(1)}x MULTIPLIER
                </div>
              )}
              {/* The "Combo Lost" message */}
              {showComboBreak && (
                <div className="combo-break-indicator">COMBO LOST</div>
              )}
            </div>
            <div className="timer">{timeLeft}</div>
            <h2>Guess the song!</h2>
            <div className="options-grid">
              {options.map(song => song && (
                <button
                  key={song.id}
                  onClick={() => handleAnswer(song)}
                  className={getButtonClassName(song)}
                  disabled={answered}
                >
                  <img
                    // Use the smallest available image (last in the array)
                    src={song.album?.images[song.album.images.length - 1]?.url}
                    alt={song.name}
                    className="option-img"
                  />
                  <div className="option-text">
                    <span className="song-name">{song.name}</span>
                    <span className="artist-name">{song.artists.map(a => a.name).join(', ')}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        );
      case 'results':
        const lastQuestionPoints = pointsGained || 0;
        const finalScore = score - lastQuestionPoints + lastQuestionPoints;

        return (
          <div className="results-container">
            <h1>Quiz Finished!</h1>
            <h2>Your final score is: {finalScore}</h2>

            {/* --- NEW: High Score Display --- */}
            <h3 className="highscore-text">All-Time High: {highScore}</h3>
            {finalScore === highScore && finalScore > 0 && (
              <p className="new-highscore-message">
                🎉 NEW HIGH SCORE! 🎉
              </p>
            )}

            <button onClick={restartQuiz} className="restart-btn">Play Again</button>
            <button onClick={handleLogout} className="restart-btn" style={{ backgroundColor: '#555', marginLeft: '1rem' }}>Logout</button>
            <div className="playlist-summary">
              <h3 className="playlist-title">Quiz Playlist</h3>
              <ul className="results-song-list">
                {quizSongs.map(song => (
                  <li key={song.id} className="song-list-item">
                    <a
                      href={`http://open.spotify.com/track/${song.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={`Listen to ${song.name} on Spotify`}
                    >
                      <img
                        src={song.album?.images[song.album.images.length - 1]?.url}
                        alt={song.name}
                        className="song-list-img"
                      />
                      <div className="song-list-text">
                        <span className="song-name">{song.name}</span>
                        <span className="artist-name">{song.artists.map(a => a.name).join(', ')}</span>
                      </div>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        );
      default: return <div><h1>Connecting to Spotify...</h1><p>Please wait.</p></div>;
    }
  };

  return (
    <div className="App">
      {showCompatibilityWarning && (
        <div className="compatibility-warning">
          <p>
            For the best experience, we recommend using Chrome on Android. Playback may not work as expected in Firefox.
          </p>
          <button
            onClick={() => setShowCompatibilityWarning(false)}
            className="warning-close-btn"
            title="Dismiss"
          >
            &times;
          </button>
        </div>
      )}
      {renderContent()}
    </div>
  );
}

export default App;