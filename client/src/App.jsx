import { Routes, Route } from "react-router-dom";
import HomePage from "./pages/HomePage";
import LobbyPage from "./pages/LobbyPage";
import RoomPage from "./pages/RoomPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/room/:roomCode/lobby" element={<LobbyPage />} />
      <Route path="/room/:roomCode" element={<RoomPage />} />
    </Routes>
  );
}