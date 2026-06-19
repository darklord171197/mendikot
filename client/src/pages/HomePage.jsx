import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { socket } from "../socket";
import { AVATAR_OPTIONS, getAvatar, setAvatar } from "../avatars";

export default function HomePage() {
  const [name, setName]       = useState(localStorage.getItem("playerName") || "");
  const [joinCode, setJoinCode] = useState("");
  const [mode, setMode]       = useState("4p");
  const [difficulty, setDifficulty] = useState("pro");
  const [error, setError]     = useState("");
  const [busy, setBusy]       = useState(false);
  const [avatar, setAvatarState] = useState(getAvatar());
  const navigate = useNavigate();

  const pickAvatar = (emoji) => {
    setAvatar(emoji);
    setAvatarState(emoji);
  };

  useEffect(() => {
    const handleSession = ({ roomCode, token }) => {
      if (roomCode && token) localStorage.setItem(`token:${roomCode}`, token);
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
    if (!safeName) { setError("Please enter your name."); return null; }
    localStorage.setItem("playerName", safeName);
    setError("");
    return safeName;
  };

  const launch = (event, extra = {}) => {
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
      cleanup(); setBusy(false);
      navigate(`/room/${state.roomCode}/lobby`);
    };
    const onError = (msg) => {
      if (settled) return;
      cleanup(); setBusy(false);
      setError(typeof msg === "string" ? msg : "Server error.");
    };
    const timer = setTimeout(() => {
      if (settled) return;
      cleanup(); setBusy(false);
      setError("Server didn't respond. Try again.");
    }, 8000);

    socket.on("state", onState);
    socket.on("errorMessage", onError);
    socket.emit(event, { name: safeName, mode, avatar, ...extra });
  };

  const createRoom    = () => launch("createRoom");
  const createBotGame = () => launch("createBotGame", { difficulty });

  const joinRoom = () => {
    const safeName = validateName();
    if (!safeName) return;
    const c = joinCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{5}$/.test(c)) {
      setError("Room code must be 5 letters or numbers.");
      return;
    }
    navigate(`/room/${c}/lobby`);
  };

  return (
    <div className="home-page">
      <div className="home-card">
        <div className="brand-badge">♠ ♥ ♦ ♣</div>
        <h1>Mendikot</h1>
        <p className="subtitle">Play with friends or bots</p>

        <button
          type="button"
          className="home-profile-btn"
          onClick={() => navigate("/profile")}
          title="Profile, avatar and badges"
        >
          {avatar} Profile
        </button>

        <input
          className="input"
          placeholder="Enter your name"
          value={name}
          maxLength={20}
          onChange={(e) => setName(e.target.value)}
        />

        <div className="avatar-picker avatar-picker-compact">
          {AVATAR_OPTIONS.slice(0, 10).map((emoji) => (
            <button
              key={emoji}
              type="button"
              className={"avatar-option" + (emoji === avatar ? " avatar-selected" : "")}
              onClick={() => pickAvatar(emoji)}
            >
              {emoji}
            </button>
          ))}
        </div>

        <div className="mode-buttons">
          <button className={mode === "4p" ? "mode active" : "mode"} onClick={() => setMode("4p")} type="button">
            4 Player
          </button>
          <button className={mode === "6p" ? "mode active" : "mode"} onClick={() => setMode("6p")} type="button">
            6 Player
          </button>
        </div>

        {error && <div className="error-box">{error}</div>}

        <div className="button-grid">
          <button className="primary-btn" onClick={createRoom} disabled={busy}>
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

          <div className="difficulty-row">
            <span className="difficulty-label">Bot difficulty</span>
            <div className="difficulty-btns">
              {[
                { id: "noob",   label: "Noob",   desc: "Random" },
                { id: "medium", label: "Medium",  desc: "Strategy" },
                { id: "pro",    label: "Pro",     desc: "Full tracking" },
              ].map(({ id, label, desc }) => (
                <button
                  key={id}
                  type="button"
                  className={"diff-btn" + (difficulty === id ? " diff-active" : "")}
                  onClick={() => setDifficulty(id)}
                  title={desc}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <button className="primary-btn" onClick={createBotGame} disabled={busy}>
            {busy ? "Loading..." : "Play With Bots"}
          </button>
        </div>
      </div>
    </div>
  );
}
