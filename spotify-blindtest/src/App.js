import React, { useState, useEffect, useRef } from 'react';
import './App.css';

const CLIENT_ID = '806836d9363342b9b4961ed33d3fc918'; // IMPORTANT: Add your Spotify Client ID here
const REDIRECT_URI = 'http://localhost:3000';
const SCOPES = 'user-read-private user-read-email user-library-read streaming';

function App() {
  // Authentication & Core State
  const [accessToken, setAccessToken] = useState(null);
  const [user, setUser] = useState(null);

  // SDK and Player State
  const [player, setPlayer] = useState(null);
  const [deviceId, setDeviceId] = useState(null);
  const [sdkReady, setSdkReady] = useState(false);

  // Game State
  const [likedSongs, setLikedSongs] = useState([]);
  const [quizSongs, setQuizSongs] = useState([]);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [score, setScore] = useState(0);
  const [options, setOptions] = useState([]);
  // ---- CHANGE: Added 'ready' to the possible game states ----
  const [gameState, setGameState] = useState('login'); // login, loading, ready, quiz, results

  const startTimeRef = useRef(null);

  // Step 1: Handle Authentication Token
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

  // Step 2: Dynamically Load Spotify SDK
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

  // Step 3: Initialize Player & Connect
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

  // Step 4: Fetch User Data & Songs once Player is ready
  useEffect(() => {
    if (deviceId && accessToken) {
      const fetchAllData = async () => {
        try {
          const userResponse = await fetch('https://api.spotify.com/v1/me', { headers: { 'Authorization': `Bearer ${accessToken}` } });
          if (!userResponse.ok) throw new Error('Failed to fetch user');
          const userData = await userResponse.json();
          setUser(userData);

          let tracks = [];
          let url = 'https://api.spotify.com/v1/me/tracks?limit=50';
          while (url) {
            const tracksResponse = await fetch(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
            if (!tracksResponse.ok) throw new Error('Failed to fetch tracks');
            const data = await tracksResponse.json();
            tracks.push(...data.items);
            url = data.next;
          }

          const filteredTracks = tracks.map(item => item.track).filter(track => track && track.duration_ms >= 30000);
          if (filteredTracks.length < 10) {
            alert("You need at least 10 liked songs (longer than 30s) to play.");
            handleLogout();
            return;
          }
          setLikedSongs(filteredTracks);
          // ---- CHANGE: Instead of starting quiz automatically, set game state to 'ready' ----
          setGameState('ready');
        } catch (error) {
          console.error("Error fetching data:", error);
          handleLogout();
        }
      };
      fetchAllData();
    }
  }, [deviceId, accessToken]);

  const handleLogin = async () => {
    // ... (This function is unchanged)
    const generateRandomString = (length) => { const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'; const values = crypto.getRandomValues(new Uint8Array(length)); return values.reduce((acc, x) => acc + possible[x % possible.length], ""); };
    const sha256 = async (plain) => { const encoder = new TextEncoder(); const data = encoder.encode(plain); return window.crypto.subtle.digest('SHA-256', data); };
    const base64encode = (input) => { return btoa(String.fromCharCode(...new Uint8Array(input))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_'); };
    const codeVerifier = generateRandomString(64); window.localStorage.setItem('code_verifier', codeVerifier); const hashed = await sha256(codeVerifier); const codeChallenge = base64encode(hashed); const authUrl = new URL("https://accounts.spotify.com/authorize");
    authUrl.search = new URLSearchParams({ response_type: 'token', client_id: CLIENT_ID, scope: SCOPES, redirect_uri: REDIRECT_URI, code_challenge_method: 'S256', code_challenge: codeChallenge, }).toString();
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
    const currentSong = currentQuizSongs[questionIndex];
    const otherSongs = allLikedSongs.filter(s => s.id !== currentSong.id).sort(() => 0.5 - Math.random()).slice(0, 3);
    const answerOptions = [currentSong, ...otherSongs].sort(() => 0.5 - Math.random());
    setOptions(answerOptions);
    playSong(currentSong.uri, currentSong.duration_ms);
  };

  const playSong = (uri, duration_ms) => {
    if (!deviceId) { console.error("No active device."); return; }
    const playUrl = `https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`;
    fetch(playUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
      body: JSON.stringify({ uris: [uri], position_ms: Math.floor(Math.random() * (duration_ms - 15000)) })
    })
      .then(response => !response.ok && console.error('Failed to start playback.', response.status, response.statusText))
      .catch(error => console.error('Error during playback request:', error));

    startTimeRef.current = Date.now();
    setTimeout(() => player && player.pause(), 15000);
  };

  const handleAnswer = (selectedSong) => {
    if (player) player.pause();
    const correctSong = quizSongs[currentQuestion];
    if (selectedSong.id === correctSong.id) {
      const timeTaken = (Date.now() - startTimeRef.current) / 1000;
      const points = Math.max(10, 100 - Math.floor(timeTaken * 5));
      setScore(score + points);
    }
    const nextQuestion = currentQuestion + 1;
    if (nextQuestion < quizSongs.length) {
      setCurrentQuestion(nextQuestion);
      loadQuestion(nextQuestion, quizSongs, likedSongs);
    } else {
      setGameState('results');
    }
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
      case 'loading':
        return <div><h1>Loading Your Music...</h1><p>Fetching liked songs. Please wait.</p></div>;
      // ---- CHANGE: Added a new render case for the 'ready' state ----
      case 'ready':
        return (
          <div>
            <h1>Ready to Play?</h1>
            {user && <p>Welcome, {user.display_name}!</p>}
            <p>Your liked songs are loaded. Click below to start the quiz.</p>
            <button onClick={startQuiz} className="quiz-btn">Start Quiz</button>
          </div>
        );
      case 'quiz':
        return (
          <div className="quiz-container">
            <div className="question-counter">Song {currentQuestion + 1} / {quizSongs.length}</div>
            <div className="score">Score: {score}</div>
            <h2>Guess the song!</h2>
            <div className="options-grid">
              {options.map(song => song && (
                <button key={song.id} onClick={() => handleAnswer(song)} className="option-btn">
                  {song.name} by {song.artists.map(a => a.name).join(', ')}
                </button>
              ))}
            </div>
          </div>
        );
      case 'results':
        return (
          <div className="results-container">
            <h1>Quiz Finished!</h1>
            <h2>Your final score is: {score}</h2>
            <button onClick={restartQuiz} className="restart-btn">Play Again</button>
            <button onClick={handleLogout} className="restart-btn" style={{ backgroundColor: '#555', marginLeft: '1rem' }}>Logout</button>
          </div>
        );
      default:
        return <div><h1>Connecting to Spotify...</h1><p>Please wait.</p></div>;
    }
  };

  return <div className="App">{renderContent()}</div>;
}

export default App;