import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { socket } from "../socket";

const SUIT_SYMBOL = {
  s: "♠",
  h: "♥",
  d: "♦",
  c: "♣",
};

function Card({ card, playable, onClick }) {
  const red = card.s === "h" || card.s === "d";

  return (
    <button
      className={`card ${red ? "red" : "black"} ${playable ? "playable" : "disabled"}`}
      onClick={onClick}
      disabled={!playable}
    >
      <span className="card-value">{card.v}</span>
      <span className="card-suit">{SUIT_SYMBOL[card.s]}</span>
    </button>
  );
}

export default function RoomPage() {
  const { roomCode } = useParams();
  const navigate = useNavigate();

  const [state, setState] = useState(null);
  const [error, setError] = useState("");
  const [pendingTrumpCard, setPendingTrumpCard] = useState(null);

  const playerName = localStorage.getItem("playerName");

  useEffect(() => {
    if (!playerName) {
      navigate("/");
      return;
    }

    const code = roomCode?.toUpperCase();

    const handleState = (newState) => {
      setState(newState);
      setError("");
    };

    const handleError = (msg) => {
      setError(msg);
    };

    const handleReconnectFailed = () => {
      socket.emit("joinRoom", {
        roomCode: code,
        name: playerName,
      });
    };

    const handleNeedTrump = ({ cardId }) => {
      setPendingTrumpCard(cardId);
    };

    socket.on("state", handleState);
    socket.on("errorMessage", handleError);
    socket.on("reconnectFailed", handleReconnectFailed);
    socket.on("needTrump", handleNeedTrump);

    socket.emit("reconnectPlayer", {
      roomCode: code,
      name: playerName,
    });

    setTimeout(() => {
      if (!state) {
        socket.emit("joinRoom", {
          roomCode: code,
          name: playerName,
        });
      }
    }, 500);

    return () => {
      socket.off("state", handleState);
      socket.off("errorMessage", handleError);
      socket.off("reconnectFailed", handleReconnectFailed);
      socket.off("needTrump", handleNeedTrump);
    };
  }, [roomCode, playerName, navigate]);

  const myTurn = state && state.currentPlayer === state.myIndex;
  const currentPlayer = useMemo(() => {
    if (!state) return null;
    return state.players.find((p) => p.index === state.currentPlayer);
  }, [state]);

  const copyInvite = async () => {
    await navigator.clipboard.writeText(window.location.href);
    alert("Room link copied.");
  };

  const startGame = () => {
    socket.emit("startGame", {
      roomCode,
    });
  };

  const nextRound = () => {
    socket.emit("nextRound", {
      roomCode,
    });
  };

  const playCard = (card, selectedTrump = null) => {
    socket.emit("playCard", {
      roomCode,
      cardId: card.id,
      selectedTrump,
    });
  };

  const chooseTrump = (suit) => {
    if (!pendingTrumpCard) return;

    socket.emit("playCard", {
      roomCode,
      cardId: pendingTrumpCard,
      selectedTrump: suit,
    });

    setPendingTrumpCard(null);
  };

  if (!state) {
    return (
      <div className="game-page">
        <div className="loading-card">
          <h2>Connecting to room...</h2>
          <p>Room: {roomCode}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="game-page">
      <div className="top-bar">
        <div>
          <h2>Room: {state.roomCode}</h2>
          <p>{state.message}</p>
        </div>

        <div className="top-actions">
          <button onClick={copyInvite}>Copy Invite Link</button>
          <button onClick={() => navigate("/")}>Home</button>
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="score-board">
        <div>
          <span>Team 1</span>
          <strong>{state.scores?.[0] || 0}</strong>
          <small>Tricks: {state.tricksWon?.[0] || 0}</small>
          <small>10s: {state.tensWon?.[0] || 0}</small>
        </div>

        <div>
          <span>Trump</span>
          <strong>{state.trump ? SUIT_SYMBOL[state.trump] : "Hidden"}</strong>
        </div>

        <div>
          <span>Team 2</span>
          <strong>{state.scores?.[1] || 0}</strong>
          <small>Tricks: {state.tricksWon?.[1] || 0}</small>
          <small>10s: {state.tensWon?.[1] || 0}</small>
        </div>
      </div>

      <div className="table-area">
        <div className="players-grid">
          {state.players.map((p) => (
            <div
              key={p.index}
              className={`player-pill ${
                state.currentPlayer === p.index ? "active-turn" : ""
              } ${p.index === state.myIndex ? "me" : ""}`}
            >
              <div className="avatar">{p.isBot ? "🤖" : "👤"}</div>
              <div>
                <strong>
                  {p.name}
                  {p.index === state.myIndex ? " (You)" : ""}
                </strong>
                <span>
                  {p.connected ? "Online" : "Offline"} · Cards{" "}
                  {state.handCounts?.[p.index] ?? 0}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="center-table">
          <div className="turn-label">
            {state.status === "waiting"
              ? `Waiting for players ${state.players.length}/${state.playerCount}`
              : state.status === "roundOver"
              ? "Round Over"
              : myTurn
              ? "Your Turn"
              : `${currentPlayer?.name || "Player"}'s Turn`}
          </div>

          <div className="trick-zone">
            {state.trick.length === 0 ? (
              <div className="empty-trick">No cards played yet</div>
            ) : (
              state.trick.map((t) => (
                <div key={`${t.playerIndex}-${t.card.id}`} className="played-card-wrap">
                  <Card card={t.card} playable={false} onClick={() => {}} />
                  <span>{t.playerName}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="bottom-panel">
        {state.isHost && state.status === "waiting" && (
          <button className="start-btn" onClick={startGame}>
            Start Game
          </button>
        )}

        {state.isHost && state.status === "roundOver" && (
          <button className="start-btn" onClick={nextRound}>
            Next Round
          </button>
        )}

        <h3>Your Cards</h3>

        <div className="hand">
          {state.myHand.map((card) => {
            const playable = state.playableCardIds?.includes(card.id);

            return (
              <Card
                key={card.id}
                card={card}
                playable={playable}
                onClick={() => playCard(card)}
              />
            );
          })}
        </div>
      </div>

      {pendingTrumpCard && (
        <div className="modal-backdrop">
          <div className="trump-modal">
            <h2>Choose Trump</h2>
            <p>You cannot follow suit. Select trump suit.</p>

            <div className="trump-options">
              {["s", "h", "d", "c"].map((suit) => (
                <button key={suit} onClick={() => chooseTrump(suit)}>
                  {SUIT_SYMBOL[suit]}
                </button>
              ))}
            </div>

            <button className="cancel-btn" onClick={() => setPendingTrumpCard(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}