import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { socket } from "../socket";

export default function HomePage() {
  const [name, setName] = useState(localStorage.getItem("playerName") || "");
  const [joinCode, setJoinCode] = useState("");
  const [mode, setMode] = useState("4p");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const handleSession = ({ roomCode, token }) => {
      if (roomCode && token) {
        localStorage.setItem(`token:${roomCode}`, token);
      }
    };
    const handleError = (msg) => {
      setBusy(false);
      setError(typeof msg === "string" ? msg : "Something went wrong.");
    };
    socket.on("session", handleSession);
    socket.on("errorMessage", handleError);
    return () => {
      socket.off("session", handleSession);
      socket.off("errorMessage", handleError);
    };
  }, []);

  const validateName = () => {
    const safeName = name.trim();
    if (!safeName) {
      setError("Please enter your name.");
      return null;
    }
    localStorage.setItem("playerName", safeName);
    setError("");
    return safeName;
  };

  const launch = (event) => {
    const safeName = validateName();
    if (!safeName || busy) return;
    setBusy(true);

    let settled = false;
    const cleanup = () => {
      settled = true;
      socket.off("state", onState);
      socket.off("errorMessage", onError);
      clearTimeout(timer);
    };
    const onState = (state) => {
      if (settled) return;
      cleanup();
      setBusy(false);
      navigate(`/room/${state.roomCode}`);
    };
    const onError = (msg) => {
      if (settled) return;
      cleanup();
      setBusy(false);
      setError(typeof msg === "string" ? msg : "Server error.");
    };
    const timer = setTimeout(() => {
      if (settled) return;
      cleanup();
      setBusy(false);
      setError("Server didn't respond. Try again.");
    }, 8000);

    socket.on("state", onState);
    socket.on("errorMessage", onError);
    socket.emit(event, { name: safeName, mode });
  };

  const createRoom = () => launch("createRoom");
  const createBotGame = () => launch("createBotGame");

  const joinRoom = () => {
    const safeName = validateName();
    if (!safeName) return;

    const code = joinCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{5}$/.test(code)) {
      setError("Room code must be 5 letters or numbers.");
      return;
    }

    navigate(`/room/${code}`);
  };

  return (
    <div className="home-page">
      <div className="home-card">
        <div className="brand-badge">♠ ♥ ♦ ♣</div>
        <h1>Mendikot</h1>
        <p className="subtitle">Play with friends or bots</p>

        <input
          className="input"
          placeholder="Enter your name"
          value={name}
          maxLength={20}
          onChange={(e) => setName(e.target.value)}
        />

        <div className="mode-buttons">
          <button
            className={mode === "4p" ? "mode active" : "mode"}
            onClick={() => setMode("4p")}
            type="button"
          >
            4 Player
          </button>
          <button
            className={mode === "6p" ? "mode active" : "mode"}
            onClick={() => setMode("6p")}
            type="button"
          >
            6 Player
          </button>
        </div>

        {error && <div className="error-box">{error}</div>}

        <div className="button-grid">
          <button
            className="primary-btn"
            onClick={createRoom}
            disabled={busy}
          >
            {busy ? "Creating..." : "Create Multiplayer Room"}
          </button>

          <div className="join-box">
            <input
              className="input"
              placeholder="Room Code"
              value={joinCode}
              maxLength={5}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            />
            <button className="secondary-btn" onClick={joinRoom}>
              Join Room
            </button>
          </div>
        </div>

        <div className="bot-box">
          <p>Play offline against bots in the selected mode.</p>
          <button
            className="primary-btn"
            onClick={createBotGame}
            disabled={busy}
          >
            {busy ? "Loading..." : "Play With Bots"}
          </button>
        </div>
      </div>
    </div>
  );
}
