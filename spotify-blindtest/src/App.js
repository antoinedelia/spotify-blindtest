import React, { useState, useEffect, useRef } from 'react';
import './App.css';

// Configuration
const CLIENT_ID = '806836d9363342b9b4961ed33d3fc918'; // IMPORTANT: Add your Spotify Client ID
const REDIRECT_URI = 'http://localhost:3000';
const SCOPES = 'user-read-private user-read-email user-library-read streaming';
const QUIZ_DURATION = 15; // Seconds per question
const FEEDBACK_DELAY = 2000; // Milliseconds to show feedback

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
        volume: 0.5
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
    if (deviceId && accessToken) {
      const fetchAllData = async () => {
        try {
          // Fetch User Profile
          const userResponse = await fetch(SPOTIFY_API.me, { headers: { 'Authorization': `Bearer ${accessToken}` } });
          if (!userResponse.ok) throw new Error('Failed to fetch user');
          const userData = await userResponse.json();
          setUser(userData);

          // 1. Make a single request to get the total number of liked songs.
          const initialTracksUrl = new URL(SPOTIFY_API.tracks);
          initialTracksUrl.searchParams.append('limit', 1);
          const initialResponse = await fetch(initialTracksUrl, { headers: { 'Authorization': `Bearer ${accessToken}` } });
          if (!initialResponse.ok) throw new Error('Failed to fetch initial track count');
          const initialData = await initialResponse.json();
          const totalTracks = initialData.total;

          // 2. Calculate all the promises we need to make.
          const limit = 50;
          const fields = 'items(track(id,name,uri,duration_ms,artists(name)))';
          const promises = [];
          for (let offset = 0; offset < totalTracks; offset += limit) {
            const url = new URL(SPOTIFY_API.tracks);
            url.searchParams.append('limit', limit);
            url.searchParams.append('offset', offset);
            url.searchParams.append('fields', fields);
            promises.push(fetch(url, { headers: { 'Authorization': `Bearer ${accessToken}` } }));
          }

          // 3. Execute all promises in parallel.
          const responses = await Promise.all(promises);
          for (const res of responses) {
            if (!res.ok) {
              if (res.status === 401) handleLogout();
              throw new Error(`A fetch request failed with status: ${res.status}`);
            }
          }

          // 4. Parse the JSON from all responses in parallel.
          const jsonPromises = responses.map(res => res.json());
          const paginatedResults = await Promise.all(jsonPromises);

          // 5. Combine the paginated results into a single flat array.
          const tracks = paginatedResults.flatMap(page => page.items);

          // Filter tracks as before
          const filteredTracks = tracks.map(item => item.track).filter(track => track && track.duration_ms >= 30000);
          if (filteredTracks.length < 10) {
            alert("You need at least 10 liked songs (longer than 30s) to play.");
            handleLogout();
            return;
          }
          setLikedSongs(filteredTracks);
          setGameState('ready');

        } catch (error) {
          console.error("Error fetching data:", error);
        }
      };
      fetchAllData();
    }
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

  const handleLogout = () => {
    if (player) player.disconnect();
    window.localStorage.removeItem('spotify_access_token');
    window.localStorage.removeItem('code_verifier');
    window.location.href = REDIRECT_URI;
  };

  const startQuiz = () => {
    const songs = likedSongs;
    const shuffled = [...songs].sort(() => 0.5 - Math.random());
    const selectedSongs = shuffled.slice(0, 10);
    setQuizSongs(selectedSongs);
    setCurrentQuestion(0);
    setScore(0);
    setGameState('quiz');
    loadQuestion(0, selectedSongs, songs);
  };

  const loadQuestion = (questionIndex, currentQuizSongs, allLikedSongs) => {
    setAnswered(false);
    setSelectedAnswer(null);
    setTimeLeft(QUIZ_DURATION);
    const currentSong = currentQuizSongs[questionIndex];
    const otherSongs = allLikedSongs.filter(s => s.id !== currentSong.id).sort(() => 0.5 - Math.random()).slice(0, 3);
    const answerOptions = [currentSong, ...otherSongs].sort(() => 0.5 - Math.random());
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
      if (player) player.pause();
    }, QUIZ_DURATION * 1000);
  };

  const handleAnswer = (selectedSong) => {
    if (answered) return;
    setAnswered(true);
    setSelectedAnswer(selectedSong);
    clearInterval(timerIntervalRef.current);
    clearTimeout(songTimeoutRef.current);
    if (player) player.pause();
    if (selectedSong && selectedSong.id === quizSongs[currentQuestion].id) {
      const points = Math.max(10, 100 - Math.floor((QUIZ_DURATION - timeLeft) * 5));
      setScore(score + points);
    }
    setTimeout(() => {
      const nextQuestion = currentQuestion + 1;
      if (nextQuestion < quizSongs.length) {
        setCurrentQuestion(nextQuestion);
        loadQuestion(nextQuestion, quizSongs, likedSongs);
      } else {
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
      case 'ready': return (<div><h1>Ready to Play?</h1>{user && <p>Welcome, {user.display_name}!</p>}<p>Your liked songs are loaded. Click below to start the quiz.</p><button onClick={startQuiz} className="quiz-btn">Start Quiz</button></div>);
      case 'quiz':
        return (
          <div className="quiz-container">
            <div className="question-counter">Song {currentQuestion + 1} / {quizSongs.length}</div>
            <div className="score">Score: {score}</div>
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
                  {song.name} by {song.artists.map(a => a.name).join(', ')}
                </button>
              ))}
            </div>
          </div>
        );
      case 'results': return (<div className="results-container"><h1>Quiz Finished!</h1><h2>Your final score is: {score}</h2><button onClick={restartQuiz} className="restart-btn">Play Again</button><button onClick={handleLogout} className="restart-btn" style={{ backgroundColor: '#555', marginLeft: '1rem' }}>Logout</button></div>);
      default: return <div><h1>Connecting to Spotify...</h1><p>Please wait.</p></div>;
    }
  };

  return <div className="App">{renderContent()}</div>;
}

export default App;