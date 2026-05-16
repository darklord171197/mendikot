import { useEffect, useMemo, useRef, useState } from "react";
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
  const [toast, setToast] = useState("");
  const [pendingTrumpCard, setPendingTrumpCard] = useState(null);

  // refs so callbacks always see latest values
  const stateRef = useRef(null);
  const joinedRef = useRef(false);
  const code = (roomCode || "").toUpperCase();
  const playerName = localStorage.getItem("playerName");

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (!playerName) {
      navigate("/");
      return;
    }
    if (!/^[A-Z0-9]{5}$/.test(code)) {
      navigate("/");
      return;
    }

    const tokenKey = `token:${code}`;

    const attemptJoin = () => {
      const token = localStorage.getItem(tokenKey) || null;
      // Try reconnect first (token-based, falls back to legacy name match
      // on the server only if no token exists for that seat).
      socket.emit("reconnectPlayer", {
        roomCode: code,
        name: playerName,
        token,
      });
    };

    const handleState = (newState) => {
      joinedRef.current = true;
      setState(newState);
      setError("");
    };

    const handleError = (msg) => {
      setError(typeof msg === "string" ? msg : "Server error.");
    };

    const handleSession = ({ roomCode: rc, token }) => {
      if (rc && token) {
        localStorage.setItem(`token:${rc}`, token);
      }
    };

    const handleReconnectFailed = () => {
      // No prior seat — try joining as a new player.
      socket.emit("joinRoom", {
        roomCode: code,
        name: playerName,
      });
    };

    const handleNeedTrump = ({ cardId }) => {
      setPendingTrumpCard(cardId);
    };

    const handleConnect = () => {
      // Whenever the socket connects (initial or after a drop), try to
      // (re)claim our seat.
      attemptJoin();
    };

    const handleDisconnect = () => {
      setToast("Disconnected — reconnecting...");
    };

    socket.on("state", handleState);
    socket.on("errorMessage", handleError);
    socket.on("session", handleSession);
    socket.on("reconnectFailed", handleReconnectFailed);
    socket.on("needTrump", handleNeedTrump);
    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);

    if (socket.connected) {
      attemptJoin();
    }

    // Fallback: if we still have no state after 700ms, try joinRoom too.
    const fallback = setTimeout(() => {
      if (!stateRef.current) {
        socket.emit("joinRoom", {
          roomCode: code,
          name: playerName,
        });
      }
    }, 700);

    // Clear the disconnect toast when state arrives
    const clearToast = setTimeout(() => setToast(""), 0);

    return () => {
      clearTimeout(fallback);
      clearTimeout(clearToast);
      socket.off("state", handleState);
      socket.off("errorMessage", handleError);
      socket.off("session", handleSession);
      socket.off("reconnectFailed", handleReconnectFailed);
      socket.off("needTrump", handleNeedTrump);
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
    };
  }, [code, playerName, navigate]);

  // hide toast when state arrives after a reconnect
  useEffect(() => {
    if (state && toast) setToast("");
  }, [state, toast]);

  const myTurn = state && state.currentPlayer === state.myIndex;
  const currentPlayer = useMemo(() => {
    if (!state) return null;
    return state.players.find((p) => p.index === state.currentPlayer);
  }, [state]);

  const copyInvite = async () => {
    const text = window.location.href;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback for non-secure contexts
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setToast("Room link copied.");
      setTimeout(() => setToast(""), 1800);
    } catch {
      setToast("Couldn't copy automatically — copy the URL from the address bar.");
      setTimeout(() => setToast(""), 2500);
    }
  };

  const startGame = () => socket.emit("startGame", { roomCode: code });
  const nextRound = () => socket.emit("nextRound", { roomCode: code });

  const leaveRoom = () => {
    socket.emit("leaveRoom");
    navigate("/");
  };

  const playCard = (card) => {
    socket.emit("playCard", {
      roomCode: code,
      cardId: card.id,
      selectedTrump: null,
    });
  };

  const chooseTrump = (suit) => {
    if (!pendingTrumpCard) return;
    socket.emit("playCard", {
      roomCode: code,
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
          <p>Room: {code}</p>
          {error && <div className="error-box">{error}</div>}
          <button
            className="secondary-btn"
            style={{ marginTop: 16 }}
            onClick={() => navigate("/")}
          >
            Back to home
          </button>
        </div>
      </div>
    );
  }

  const statusLabel =
    state.status === "waiting"
      ? `Waiting for players ${state.players.length}/${state.playerCount}`
      : state.status === "roundOver"
      ? "Round Over"
      : state.status === "gameOver"
      ? `Game Over — Team ${(state.winningTeam ?? 0) + 1} wins!`
      : myTurn
      ? "Your Turn"
      : `${currentPlayer?.name || "Player"}'s Turn`;

  return (
    <div className="game-page">
      <div className="top-bar">
        <div>
          <h2>Room: {state.roomCode}</h2>
          <p>{state.message}</p>
        </div>

        <div className="top-actions">
          <button onClick={copyInvite}>Copy Invite Link</button>
          <button onClick={leaveRoom}>Leave</button>
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}
      {toast && <div className="toast">{toast}</div>}

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
          <small>First to {state.targetScore ?? 7}</small>
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
                state.currentPlayer === p.index && state.status === "playing"
                  ? "active-turn"
                  : ""
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
          <div className="turn-label">{statusLabel}</div>

          <div className="trick-zone">
            {state.trick.length === 0 ? (
              <div className="empty-trick">No cards played yet</div>
            ) : (
              state.trick.map((t) => (
                <div
                  key={`${t.playerIndex}-${t.card.id}`}
                  className="played-card-wrap"
                >
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

        {state.isHost && state.status === "gameOver" && (
          <button className="start-btn" onClick={nextRound}>
            Play Again
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
            <p>You cannot follow suit. Select a trump suit.</p>

            <div className="trump-options">
              {["s", "h", "d", "c"].map((suit) => (
                <button key={suit} onClick={() => chooseTrump(suit)}>
                  {SUIT_SYMBOL[suit]}
                </button>
              ))}
            </div>

            <button
              className="cancel-btn"
              onClick={() => setPendingTrumpCard(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
