import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { socket } from "../socket";

export default function HomePage() {
  const [name, setName] = useState(localStorage.getItem("playerName") || "");
  const [joinCode, setJoinCode] = useState("");
  const [mode, setMode] = useState("4p");
  const navigate = useNavigate();

  const saveName = () => {
    const safeName = name.trim();
    if (!safeName) {
      alert("Please enter your name.");
      return null;
    }

    localStorage.setItem("playerName", safeName);
    return safeName;
  };

  const createRoom = () => {
    const safeName = saveName();
    if (!safeName) return;

    socket.emit("createRoom", { name: safeName });

    socket.once("state", (state) => {
      navigate(`/room/${state.roomCode}`);
    });
  };

  const createBotGame = () => {
    const safeName = saveName();
    if (!safeName) return;

    socket.emit("createBotGame", {
      name: safeName,
      mode,
    });

    socket.once("state", (state) => {
      navigate(`/room/${state.roomCode}`);
    });
  };

  const joinRoom = () => {
    const safeName = saveName();
    if (!safeName) return;

    const code = joinCode.trim().toUpperCase();

    if (!code) {
      alert("Please enter room code.");
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
          onChange={(e) => setName(e.target.value)}
        />

        <div className="button-grid">
          <button className="primary-btn" onClick={createRoom}>
            Create Multiplayer Room
          </button>

          <div className="join-box">
            <input
              className="input"
              placeholder="Room Code"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
            />
            <button className="secondary-btn" onClick={joinRoom}>
              Join Room
            </button>
          </div>
        </div>

        <div className="bot-box">
          <p>Bot Mode</p>

          <div className="mode-buttons">
            <button
              className={mode === "4p" ? "mode active" : "mode"}
              onClick={() => setMode("4p")}
            >
              4 Player
            </button>

            <button
              className={mode === "6p" ? "mode active" : "mode"}
              onClick={() => setMode("6p")}
            >
              6 Player
            </button>
          </div>

          <button className="primary-btn" onClick={createBotGame}>
            Play With Bots
          </button>
        </div>
      </div>
    </div>
  );
}