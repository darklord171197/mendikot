import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { io } from "socket.io-client";

const socket = io("http://localhost:5000");

export default function RoomPage() {
  const { roomCode } = useParams();

  const [state, setState] = useState(null);

  const playerName = localStorage.getItem("playerName");

  useEffect(() => {
    socket.emit("joinRoom", {
      roomCode,
      name: playerName,
    });

    socket.on("state", (newState) => {
      setState(newState);
    });

    socket.on("errorMessage", (msg) => {
      alert(msg);
    });

    return () => {
      socket.off("state");
      socket.off("errorMessage");
    };
  }, []);

  if (!state) {
    return <div>Connecting...</div>;
  }

  const playCard = (card) => {
    socket.emit("playCard", {
      roomCode,
      cardId: card.id,
    });
  };

  return (
    <div>
      <h2>Room: {roomCode}</h2>

      <h3>{state.message}</h3>

      <div>
        {state.players.map((p) => (
          <div key={p.index}>
            {p.name}
            {state.currentPlayer === p.index && " ← TURN"}
          </div>
        ))}
      </div>

      <hr />

      <div
        style={{
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        {state.myHand.map((card) => {
          const playable =
            state.playableCardIds?.includes(card.id);

          return (
            <button
              key={card.id}
              disabled={!playable}
              onClick={() => playCard(card)}
              style={{
                width: 60,
                height: 90,
                border: playable
                  ? "3px solid lime"
                  : "1px solid gray",
                opacity: playable ? 1 : 0.5,
                cursor: playable ? "pointer" : "not-allowed",
              }}
            >
              {card.v}
              {card.s}
            </button>
          );
        })}
      </div>

      <hr />

      {state.isHost &&
        state.status === "waiting" && (
          <button
            onClick={() => {
              socket.emit("startGame", {
                roomCode,
              });
            }}
          >
            Start Game
          </button>
        )}
    </div>
  );
}