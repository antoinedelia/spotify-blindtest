import React, { useState, useEffect, useRef, useContext } from 'react';
import { SettingsContext } from './contexts/SettingsContext';
import './App.css';

const CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID;
const REDIRECT_URI = import.meta.env.VITE_REDIRECT_URI;
const SCOPES = import.meta.env.VITE_SCOPES;
const QUIZ_DURATION = Number(import.meta.env.VITE_QUIZ_DURATION);
const FEEDBACK_DELAY = Number(import.meta.env.VITE_FEEDBACK_DELAY);
const CACHE_DURATION = Number(import.meta.env.VITE_CACHE_DURATION);
const TRACK_MIN_DURATION = Number(import.meta.env.VITE_TRACK_MIN_DURATION);
const PLAYER_VOLUME = Number(import.meta.env.VITE_PLAYER_VOLUME) || 0.5;

const SPOTIFY_API = {
  auth: 'https://accounts.spotify.com/authorize',
  me: 'https://api.spotify.com/v1/me',
  player: 'https://api.spotify.com/v1/me/player',
  token: 'https://accounts.spotify.com/api/token',
  tracks: 'https://api.spotify.com/v1/me/tracks',
};

const SettingsModal = ({ isOpen, onClose }) => {
  const { settings, updateSettings } = useContext(SettingsContext);
  const [localSettings, setLocalSettings] = useState(settings);

  useEffect(() => {
    setLocalSettings(settings);
  }, [isOpen, settings]);

  if (!isOpen) return null;

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    let numValue = parseInt(value, 10);
    if (isNaN(numValue)) {
      numValue = 0;
    }

    if (name === 'questionsPerQuiz') {
      numValue = Math.max(1, Math.min(numValue, 50));
    } else if (name === 'numAnswerOptions') {
      numValue = Math.max(2, Math.min(numValue, 10));
    }

    setLocalSettings(prev => ({ ...prev, [name]: numValue }));
  };

  const handleSave = () => {
    updateSettings(localSettings);
    onClose();
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <h2>Game Settings</h2>
        <div className="form-grid">
          <label htmlFor="questionsPerQuiz">Questions per Quiz:</label>
          <input
            type="number"
            id="questionsPerQuiz"
            name="questionsPerQuiz"
            value={localSettings.questionsPerQuiz}
            onChange={handleInputChange}
            min="1"
            max="50"
          />
          <label htmlFor="numAnswerOptions">Answer Options:</label>
          <input
            type="number"
            id="numAnswerOptions"
            name="numAnswerOptions"
            value={localSettings.numAnswerOptions}
            onChange={handleInputChange}
            min="2"
            max="10"
          />
          <label htmlFor="pointsBase">Base Points:</label>
          <input type="number" id="pointsBase" name="pointsBase" value={localSettings.pointsBase} onChange={handleInputChange} />
          <label htmlFor="pointsPerSecond">Points per Second:</label>
          <input type="number" id="pointsPerSecond" name="pointsPerSecond" value={localSettings.pointsPerSecond} onChange={handleInputChange} />
        </div>
        <div className="modal-actions">
          <button onClick={onClose} className="secondary-btn">Cancel</button>
          <button onClick={handleSave} className="quiz-btn">Save Changes</button>
        </div>
      </div>
    </div>
  );
};

function App() {
  const [accessToken, setAccessToken] = useState(null);
  const [user, setUser] = useState(null);
  const [player, setPlayer] = useState(null);
  const [deviceId, setDeviceId] = useState(null);
  const [sdkReady, setSdkReady] = useState(false);

  const [likedSongs, setLikedSongs] = useState([]);
  const [quizSongs, setQuizSongs] = useState([]);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [score, setScore] = useState(0);
  const [options, setOptions] = useState([]);
  const [gameState, setGameState] = useState('login'); // login, loading, ready, quiz, results

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
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const { settings } = useContext(SettingsContext);

  const getComboMultiplier = (currentCombo) => {
    for (const tier of settings.comboTiers) {
      if (currentCombo >= tier.threshold) {
        return tier.multiplier;
      }
    }
    return 1.0;
  };

  useEffect(() => {
    const userAgent = navigator.userAgent.toLowerCase();
    // Firefox for Android may have issues with Encrypted Media Extensions (EME).
    const isFirefoxOnAndroid = userAgent.includes('android') && userAgent.includes('firefox');
    if (isFirefoxOnAndroid) {
      setShowCompatibilityWarning(true);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    let code = params.get('code');
    let token = window.localStorage.getItem('spotify_access_token');

    if (code && !token) {
      const codeVerifier = window.localStorage.getItem('code_verifier');
      if (!codeVerifier) {
        console.error("No code verifier found in localStorage.");
        return;
      }

      const exchangeCodeForToken = async () => {
        try {
          const response = await fetch(SPOTIFY_API.token, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id: CLIENT_ID,
              grant_type: 'authorization_code',
              code,
              redirect_uri: REDIRECT_URI,
              code_verifier: codeVerifier,
            }),
          });

          if (!response.ok) {
            const errorData = await response.json();
            console.error("Token exchange failed:", errorData);
            throw new Error('Token exchange failed');
          }

          const data = await response.json();
                
          // Set the token and clean up
          window.localStorage.setItem('spotify_access_token', data.access_token);
          // Also store the refresh_token if provided (optional but recommended for long-term sessions)
          if (data.refresh_token) {
            window.localStorage.setItem('spotify_refresh_token', data.refresh_token);
          }
              
          window.localStorage.removeItem('code_verifier');

          // Clean the URL of the 'code' parameter without a full refresh
          const newUrl = window.location.origin + window.location.pathname;
          window.history.replaceState(null, '', newUrl);

          setAccessToken(data.access_token);
        } catch (error) {
          console.error("Error during code exchange:", error);
          // Handle token exchange error (e.g., show an error message, go back to login)
          // handleLogout(); // This might be too aggressive, better to handle the error gracefully
        }
      };
      exchangeCodeForToken();
    } else if (token) {
      // If a token already exists, use it
      setAccessToken(token);
    }
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

  useEffect(() => {
    const fetchAllData = async (forceRefresh = false) => {
      if (!deviceId || !accessToken) return;

      try {
        const userResponse = await fetch(SPOTIFY_API.me, { headers: { 'Authorization': `Bearer ${accessToken}` } });
        if (!userResponse.ok) throw new Error('Failed to fetch user');
        const userData = await userResponse.json();
        setUser(userData);

        const cacheKey = `blindtest_song_cache_${userData.id}`;

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
              return;
            }
          }
        }

        console.log("Cache empty, stale, or refresh forced. Fetching from Spotify API...");
        setGameState('loading');

        const initialTracksUrl = new URL(SPOTIFY_API.tracks);
        initialTracksUrl.searchParams.append('limit', 1);
        const initialResponse = await fetch(initialTracksUrl, { headers: { 'Authorization': `Bearer ${accessToken}` } });
        if (!initialResponse.ok) throw new Error('Failed to fetch initial track count');
        const initialData = await initialResponse.json();
        const totalTracks = initialData.total;
        setTotalLikedSongs(totalTracks);

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

        if (filteredTracks.length < settings.minSongsToPlay) {
          const minDurationInSeconds = TRACK_MIN_DURATION / 1000;
          alert(`You need at least ${settings.minSongsToPlay} liked songs (longer than ${minDurationInSeconds}s) to play.`);
          handleLogout();
          return;
        }

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
    if (gameState === 'results') {
      if (score > highScore) {
        setHighScore(score);
        if (user) {
          localStorage.setItem(`blindtest_highscore_${user.id}`, score);
        }
      }
    }
  }, [gameState, score, highScore, user]);

  const handleLogin = async () => {
    // Implements the PKCE Authorization Flow for Spotify.
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
      response_type: 'code',
      client_id: CLIENT_ID,
      scope: SCOPES,
      redirect_uri: REDIRECT_URI,
      code_challenge_method: 'S256',
      code_challenge: codeChallenge,
    }).toString();
    window.location.href = authUrl.toString();
  };

  const handleLogout = () => {
    if (player) player.disconnect();
    window.localStorage.removeItem('spotify_access_token');
    window.localStorage.removeItem('code_verifier');
    window.location.href = REDIRECT_URI;
  };

  // Uses the Fisher-Yates Shuffle Algorithm for unbiased randomization.
  const shuffleArray = (array) => {
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
    }
    return newArray;
  };

  const startQuiz = () => {
    if (player) {
      // Activating the player is crucial for mobile browsers to allow autoplay.
      player.activateElement().catch(err => {
        console.error('Failed to activate player for autoplay:', err);
      });
      player.setVolume(PLAYER_VOLUME).catch(e => console.error("Error resetting volume:", e));
    }

    const songs = likedSongs;
    const shuffled = shuffleArray(songs);
    const selectedSongs = shuffled.slice(0, settings.questionsPerQuiz);
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
    ).slice(0, settings.numAnswerOptions - 1);
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
      // Intentionally empty: handleAnswer(null) is called by the main timer.
    }, QUIZ_DURATION * 1000);
  };

  const handleAnswer = (selectedSong) => {
    if (answered) return;

    setAnswered(true);
    setSelectedAnswer(selectedSong);
    clearInterval(timerIntervalRef.current);
    clearTimeout(songTimeoutRef.current);

    if (selectedSong && selectedSong.id === quizSongs[currentQuestion].id) {
      const multiplier = getComboMultiplier(combo);
      let basePoints = settings.pointsBase + (timeLeft * settings.pointsPerSecond);
      if (timeLeft >= settings.timeBonusThreshold) {
        basePoints += settings.timeBonusPoints;
      }
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
        if (player) player.pause();
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
            <button onClick={handleForceRefresh} className="secondary-btn">
              Force Refresh Songs
            </button>
          </div>
        );
      case 'quiz':
        const currentMultiplier = getComboMultiplier(combo);
        let comboClassName = "combo-indicator";
        if (currentMultiplier >= 2.0) {
          comboClassName += " combo-max";
        } else if (currentMultiplier >= 1.5) {
          comboClassName += " combo-hot";
        }
        return (
          <div className="quiz-container">
            <div className="question-counter">Song {currentQuestion + 1} / {quizSongs.length}</div>
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
              {currentMultiplier > 1.0 && (
                <div
                  key={currentMultiplier} // Force re-render and re-animation on change
                  className={comboClassName}
                >
                  {currentMultiplier.toFixed(1)}x MULTIPLIER
                </div>
              )}
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
            ×
          </button>
        </div>
      )}
      <div className="main-content-wrapper">
        <button
          onClick={() => setIsSettingsOpen(true)}
          className="settings-btn"
          title={gameState === 'quiz' ? "Settings disabled during quiz" : "Settings"}
          disabled={gameState === 'quiz'}
        >
          ⚙️
        </button>
        <SettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
        />
        {renderContent()}
      </div>
    </div>
  );
}

export default App;