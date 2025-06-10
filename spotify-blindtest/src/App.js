import React, { useState, useEffect, useRef } from 'react';
import './App.css';

const CLIENT_ID = '806836d9363342b9b4961ed33d3fc918'; // IMPORTANT: Add your Spotify Client ID here
const REDIRECT_URI = 'http://localhost:3000';
const SCOPES = 'user-read-private user-read-email user-library-read streaming';
const QUIZ_DURATION = 15; // Seconds per question
const FEEDBACK_DELAY = 2000; // Milliseconds to show feedback

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

  // --- NEW: State for improved quiz experience ---
  const [timeLeft, setTimeLeft] = useState(QUIZ_DURATION);
  const [answered, setAnswered] = useState(false);
  const [selectedAnswer, setSelectedAnswer] = useState(null); // track which button was clicked
  const timerIntervalRef = useRef(null);
  const songTimeoutRef = useRef(null);


  // --- Hooks for Authentication and SDK setup (unchanged) ---
  useEffect(() => { /* ... (same as before) ... */
    const hash = window.location.hash; let token = window.localStorage.getItem('spotify_access_token');
    if (!token && hash) { token = new URLSearchParams(hash.substring(1)).get('access_token'); window.location.hash = ''; window.localStorage.setItem('spotify_access_token', token); }
    setAccessToken(token);
  }, []);
  useEffect(() => { /* ... (same as before) ... */
    if (accessToken) {
      window.onSpotifyWebPlaybackSDKReady = () => setSdkReady(true);
      if (!document.querySelector('script[src="https://sdk.scdn.co/spotify-player.js"]')) {
        const script = document.createElement('script'); script.src = 'https://sdk.scdn.co/spotify-player.js'; script.async = true; document.body.appendChild(script);
      } else if (window.Spotify) { setSdkReady(true); }
    }
  }, [accessToken]);
  useEffect(() => { /* ... (same as before) ... */
    if (sdkReady && accessToken) {
      const spotifyPlayer = new window.Spotify.Player({ name: 'Spotify Blindtest', getOAuthToken: cb => { cb(accessToken); }, volume: 0.5 });
      spotifyPlayer.addListener('ready', ({ device_id }) => { setDeviceId(device_id); setGameState('loading'); });
      spotifyPlayer.addListener('not_ready', ({ device_id }) => console.log('Device offline', device_id));
      spotifyPlayer.addListener('authentication_error', ({ message }) => { console.error(message); handleLogout(); });
      spotifyPlayer.connect().then(success => success && console.log("Player connected!"));
      setPlayer(spotifyPlayer);
      return () => spotifyPlayer.disconnect();
    }
  }, [sdkReady, accessToken]);
  useEffect(() => { /* ... (same as before) ... */
    if (deviceId && accessToken) {
      const fetchAllData = async () => {
        try {
          const userResponse = await fetch('https://api.spotify.com/v1/me', { headers: { 'Authorization': `Bearer ${accessToken}` } });
          if (!userResponse.ok) throw new Error('Failed to fetch user');
          const userData = await userResponse.json(); setUser(userData);
          let tracks = []; let url = 'https://api.spotify.com/v1/me/tracks?limit=50';
          while (url) { const tracksResponse = await fetch(url, { headers: { 'Authorization': `Bearer ${accessToken}` } }); if (!tracksResponse.ok) throw new Error('Failed to fetch tracks'); const data = await tracksResponse.json(); tracks.push(...data.items); url = data.next; }
          const filteredTracks = tracks.map(item => item.track).filter(track => track && track.duration_ms >= 30000);
          if (filteredTracks.length < 10) { alert("You need at least 10 liked songs (longer than 30s) to play."); handleLogout(); return; }
          setLikedSongs(filteredTracks); setGameState('ready');
        } catch (error) { console.error("Error fetching data:", error); handleLogout(); }
      };
      fetchAllData();
    }
  }, [deviceId, accessToken]);

  // --- NEW: Effect to handle the countdown timer ---
  useEffect(() => {
    if (gameState === 'quiz' && !answered) {
      timerIntervalRef.current = setInterval(() => {
        setTimeLeft(prevTime => {
          if (prevTime <= 1) {
            clearInterval(timerIntervalRef.current);
            handleAnswer(null); // Time's up, count as wrong answer
            return 0;
          }
          return prevTime - 1;
        });
      }, 1000);
    }
    // Cleanup interval on component unmount or when an answer is given
    return () => clearInterval(timerIntervalRef.current);
  }, [gameState, answered, currentQuestion]);


  const handleLogin = async () => { /* ... (same as before) ... */
    const generateRandomString = (l) => { const p = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'; const v = crypto.getRandomValues(new Uint8Array(l)); return v.reduce((a, x) => a + p[x % p.length], "") }; const s = async (p) => { const e = new TextEncoder(); const d = e.encode(p); return window.crypto.subtle.digest('SHA-256', d) }; const b = (i) => { return btoa(String.fromCharCode(...new Uint8Array(i))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_') }; const c = generateRandomString(64); window.localStorage.setItem('code_verifier', c); const h = await s(c); const o = b(h); const a = new URL("https://accounts.spotify.com/authorize"); a.search = new URLSearchParams({ response_type: 'token', client_id: CLIENT_ID, scope: SCOPES, redirect_uri: REDIRECT_URI, code_challenge_method: 'S256', code_challenge: o }).toString(); window.location.href = a.toString();
  };
  const handleLogout = () => { /* ... (same as before) ... */
    if (player) player.disconnect(); window.localStorage.removeItem('spotify_access_token'); window.localStorage.removeItem('code_verifier'); window.location.href = REDIRECT_URI;
  };

  const startQuiz = () => { /* ... (same as before) ... */
    const songs = likedSongs; const shuffled = [...songs].sort(() => 0.5 - Math.random()); const selectedSongs = shuffled.slice(0, 10); setQuizSongs(selectedSongs); setCurrentQuestion(0); setScore(0); setGameState('quiz'); loadQuestion(0, selectedSongs, songs);
  };

  const loadQuestion = (questionIndex, currentQuizSongs, allLikedSongs) => {
    // --- CHANGE: Reset all question-specific states ---
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

    // --- CHANGE: Clear any lingering song timeout from the previous question ---
    if (songTimeoutRef.current) {
      clearTimeout(songTimeoutRef.current);
    }

    const playUrl = `https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`;
    fetch(playUrl, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` }, body: JSON.stringify({ uris: [uri], position_ms: Math.floor(Math.random() * (duration_ms - (QUIZ_DURATION * 1000))) }) });

    // Set a timeout to pause the music
    songTimeoutRef.current = setTimeout(() => {
      if (player) player.pause();
    }, QUIZ_DURATION * 1000);
  };

  const handleAnswer = (selectedSong) => {
    if (answered) return; // Prevent multiple answers

    // --- CHANGE: Major updates to handle feedback and scoring ---
    setAnswered(true);
    setSelectedAnswer(selectedSong);
    clearInterval(timerIntervalRef.current);
    clearTimeout(songTimeoutRef.current);
    if (player) player.pause();

    if (selectedSong && selectedSong.id === quizSongs[currentQuestion].id) {
      // Calculate points based on speed (more points for faster answers)
      const points = Math.max(10, 100 - Math.floor((QUIZ_DURATION - timeLeft) * 5));
      setScore(score + points);
    }

    // Delay before moving to the next question to show feedback
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
    if (!answered) return "option-btn"; // Default state

    const correctSongId = quizSongs[currentQuestion].id;
    if (song.id === correctSongId) {
      return "option-btn correct"; // Always show the correct answer in green
    }
    if (song.id === selectedAnswer?.id) {
      return "option-btn incorrect"; // Show the selected wrong answer in red
    }
    return "option-btn"; // Other buttons
  };

  const restartQuiz = () => startQuiz();

  const renderContent = () => { /* ... (same render logic as before, but with new Timer display) ... */
    if (!accessToken) { return (<div><h1>Spotify Blindtest</h1><p>Test your knowledge on your own liked songs!</p><button onClick={handleLogin} className="login-btn">Login with Spotify</button></div>); }
    switch (gameState) {
      case 'loading': return <div><h1>Loading Your Music...</h1><p>Fetching liked songs. Please wait.</p></div>;
      case 'ready': return (<div><h1>Ready to Play?</h1>{user && <p>Welcome, {user.display_name}!</p>}<p>Your liked songs are loaded. Click below to start the quiz.</p><button onClick={startQuiz} className="quiz-btn">Start Quiz</button></div>);
      case 'quiz':
        return (
          <div className="quiz-container">
            <div className="question-counter">Song {currentQuestion + 1} / {quizSongs.length}</div>
            <div className="score">Score: {score}</div>
            {/* --- NEW: Visual Timer --- */}
            <div className="timer">{timeLeft}</div>
            <h2>Guess the song!</h2>
            <div className="options-grid">
              {options.map(song => song && (
                <button
                  key={song.id}
                  onClick={() => handleAnswer(song)}
                  // --- CHANGE: Dynamic class and disabled state ---
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