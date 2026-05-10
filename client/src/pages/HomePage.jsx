import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { io } from "socket.io-client";

const socket = io("http://localhost:5000");

export default function HomePage() {
  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState("");

  const navigate = useNavigate();

  const createRoom = () => {
    if (!name.trim()) return;

    socket.emit("createRoom", {
      name,
    });

    socket.once("state", (state) => {
      localStorage.setItem("playerName", name);
      navigate(`/room/${state.roomCode}`);
    });
  };

  const joinRoom = () => {
    if (!name.trim()) return;
    if (!joinCode.trim()) return;

    localStorage.setItem("playerName", name);

    navigate(`/room/${joinCode.toUpperCase()}`);
  };

  return (
    <div className="home">
      <h1>Mendikot</h1>

      <input
        placeholder="Your Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />

      <button onClick={createRoom}>
        Create Room
      </button>

      <hr />

      <input
        placeholder="Room Code"
        value={joinCode}
        onChange={(e) => setJoinCode(e.target.value)}
      />

      <button onClick={joinRoom}>
        Join Room
      </button>
    </div>
  );
}