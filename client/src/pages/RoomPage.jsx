import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { socket } from "../socket";

const SUIT_SYMBOL = { s: "♠", h: "♥", d: "♦", c: "♣" };
const SUIT_NAME = { s: "Spades", h: "Hearts", d: "Diamonds", c: "Clubs" };

function CardFace({ card, mode, onClick, size }) {
  const m = mode || "played";
  const sz = size || "md";
  const red = card.s === "h" || card.s === "d";
  const isTen = card.v === "10";
  const clickable = m === "playable";
  const klass =
    "card-face size-" + sz + " mode-" + m +
    (red ? " red" : " black") + (isTen ? " is-ten" : "");
  return (
    <button
      type="button"
      className={klass}
      onClick={clickable ? onClick : undefined}
      disabled={!clickable}
      aria-label={card.v + " of " + SUIT_NAME[card.s]}
    >
      <span className="rank top">{card.v}</span>
      <span className="suit middle">{SUIT_SYMBOL[card.s]}</span>
      <span className="rank bottom">{card.v}</span>
    </button>
  );
}

function CardBackStack({ count }) {
  const shown = Math.min(count, 5);
  const backs = [];
  for (let i = 0; i < shown; i++) {
    backs.push(
      <div
        key={i}
        className="card-back"
        style={{ transform: "translateX(" + (i * 4) + "px)", zIndex: i }}
      />
    );
  }
  return (
    <div className="card-back-stack" title={count + " cards"}>
      {backs}
      <span className="hand-count">{count}</span>
    </div>
  );
}

export default function RoomPage() {
  const { roomCode } = useParams();
  const navigate = useNavigate();

  const [state, setState] = useState(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [pendingTrumpCard, setPendingTrumpCard] = useState(null);

  const stateRef = useRef(null);
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

    const tokenKey = "token:" + code;

    const attemptJoin = () => {
      const token = localStorage.getItem(tokenKey) || null;
      socket.emit("reconnectPlayer", { roomCode: code, name: playerName, token });
    };

    const handleState = (s) => {
      setState(s);
      setError("");
    };
    const handleError = (msg) =>
      setError(typeof msg === "string" ? msg : "Server error.");
    const handleSession = (data) => {
      if (data && data.roomCode && data.token) {
        localStorage.setItem("token:" + data.roomCode, data.token);
      }
    };
    const handleReconnectFailed = () =>
      socket.emit("joinRoom", { roomCode: code, name: playerName });
    const handleNeedTrump = (data) => setPendingTrumpCard(data.cardId);
    const handleConnect = () => attemptJoin();
    const handleDisconnect = () => setToast("Disconnected - reconnecting...");

    socket.on("state", handleState);
    socket.on("errorMessage", handleError);
    socket.on("session", handleSession);
    socket.on("reconnectFailed", handleReconnectFailed);
    socket.on("needTrump", handleNeedTrump);
    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);

    if (socket.connected) attemptJoin();

    const fallback = setTimeout(() => {
      if (!stateRef.current) {
        socket.emit("joinRoom", { roomCode: code, name: playerName });
      }
    }, 700);

    return () => {
      clearTimeout(fallback);
      socket.off("state", handleState);
      socket.off("errorMessage", handleError);
      socket.off("session", handleSession);
      socket.off("reconnectFailed", handleReconnectFailed);
      socket.off("needTrump", handleNeedTrump);
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
    };
  }, [code, playerName, navigate]);

  useEffect(() => {
    if (state && toast.indexOf("Disconnected") === 0) setToast("");
  }, [state, toast]);

  const myTeam = state ? state.myIndex % 2 : 0;
  const myTurn = state && state.currentPlayer === state.myIndex;
  const currentPlayer = useMemo(() => {
    if (!state) return null;
    return state.players.find((p) => p.index === state.currentPlayer);
  }, [state]);

  const seatSlots4 = ["bottom", "left", "top", "right"];
  const seatSlots6 = [
    "bottom",
    "bottom-left",
    "top-left",
    "top",
    "top-right",
    "bottom-right",
  ];
  const seatFor = (idx) => {
    if (!state) return "bottom";
    const slots = state.playerCount === 6 ? seatSlots6 : seatSlots4;
    const rel = (idx - state.myIndex + state.playerCount) % state.playerCount;
    return slots[rel];
  };
  const isAlly = (idx) => state && idx % 2 === myTeam;

  const copyInvite = async () => {
    const text = window.location.href;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
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
    } catch (e) {
      setToast("Couldn't copy - copy the URL from the address bar.");
      setTimeout(() => setToast(""), 2500);
    }
  };

  const startGame = () => socket.emit("startGame", { roomCode: code });
  const nextRound = () => socket.emit("nextRound", { roomCode: code });
  const leaveRoom = () => {
    socket.emit("leaveRoom");
    navigate("/");
  };
  const playCard = (card) =>
    socket.emit("playCard", {
      roomCode: code,
      cardId: card.id,
      selectedTrump: null,
    });
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
          {error ? <div className="error-box">{error}</div> : null}
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

  const trumpRed = state.trump === "h" || state.trump === "d";

  let centerText;
  if (state.status === "waiting") {
    centerText =
      "Waiting for players (" +
      state.players.length +
      "/" +
      state.playerCount +
      ")";
  } else if (state.status === "roundOver") {
    centerText = "Round Over";
  } else if (state.status === "gameOver") {
    centerText = "Team " + ((state.winningTeam || 0) + 1) + " wins the match!";
  } else if (myTurn) {
    centerText = "Your turn";
  } else {
    centerText = (currentPlayer ? currentPlayer.name : "...") + " is playing";
  }

  const seats = [];
  for (let i = 0; i < state.players.length; i++) {
    const p = state.players[i];
    const slot = seatFor(p.index);
    const ally = isAlly(p.index);
    const me = p.index === state.myIndex;
    const active =
      state.currentPlayer === p.index && state.status === "playing";
    const played = state.trick.find((t) => t.playerIndex === p.index);

    const seatClass =
      "seat seat-" + slot +
      (ally ? " ally" : " opp") +
      (me ? " me" : "") +
      (active ? " active" : "") +
      (p.connected ? " online" : " offline");

    seats.push(
      <Fragment key={p.index}>
        <div className={seatClass}>
          <div className="seat-head">
            <div className="avatar">{p.isBot ? "🤖" : "👤"}</div>
            <div className="seat-id">
              <div className="seat-name">{me ? p.name + " (You)" : p.name}</div>
              <div className="seat-tags">
                {me ? (
                  <span className="tag you">You</span>
                ) : ally ? (
                  <span className="tag partner">Partner</span>
                ) : (
                  <span className="tag opp">Opponent</span>
                )}
                {p.isBot ? <span className="tag bot">Bot</span> : null}
                {!p.connected ? <span className="tag off">Offline</span> : null}
              </div>
            </div>
          </div>
          <div className="seat-body">
            <CardBackStack count={(state.handCounts || [])[p.index] || 0} />
          </div>
        </div>

        {played ? (
          <div className={"played played-" + slot}>
            <CardFace card={played.card} mode="played" size="md" />
          </div>
        ) : null}
      </Fragment>
    );
  }

  return (
    <div className="game-page">
      <header className="top-bar">
        <div className="room-info">
          <h2>
            Room <span className="room-code">{state.roomCode}</span>
          </h2>
          <p className="msg">{state.message}</p>
        </div>
        <div className="top-actions">
          <button onClick={copyInvite}>Copy Link</button>
          <button onClick={leaveRoom}>Leave</button>
        </div>
      </header>

      {error ? <div className="error-box">{error}</div> : null}
      {toast ? <div className="toast">{toast}</div> : null}

      <div className="scoreboard">
        <div className={"team-card " + (myTeam === 0 ? "mine" : "theirs")}>
          <div className="team-label">
            Team 1 {myTeam === 0 ? "· You" : ""}
          </div>
          <div className="team-score">{state.scores ? state.scores[0] : 0}</div>
          <div className="team-meta">
            <span>Tricks {state.tricksWon ? state.tricksWon[0] : 0}</span>
            <span>10s {state.tensWon ? state.tensWon[0] : 0}/4</span>
          </div>
        </div>

        <div className="trump-card">
          <div className="trump-label">Trump</div>
          <div className={"trump-suit " + (trumpRed ? "red" : "")}>
            {state.trump ? SUIT_SYMBOL[state.trump] : "—"}
          </div>
          <div className="target">First to {state.targetScore || 7}</div>
        </div>

        <div className={"team-card " + (myTeam === 1 ? "mine" : "theirs")}>
          <div className="team-label">
            Team 2 {myTeam === 1 ? "· You" : ""}
          </div>
          <div className="team-score">{state.scores ? state.scores[1] : 0}</div>
          <div className="team-meta">
            <span>Tricks {state.tricksWon ? state.tricksWon[1] : 0}</span>
            <span>10s {state.tensWon ? state.tensWon[1] : 0}/4</span>
          </div>
        </div>
      </div>

      <div className="table-wrap">
        <div className={"felt seats-" + state.playerCount}>
          {seats}

          <div className="table-center">
            <div className="status-pill">{centerText}</div>
            {state.status === "playing" && state.trick.length === 0 ? (
              <div className="hint">Lead a card from your hand</div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="bottom-panel">
        <div className="host-actions">
          {state.isHost && state.status === "waiting" ? (
            <button className="start-btn" onClick={startGame}>
              Start Game
            </button>
          ) : null}
          {state.isHost && state.status === "roundOver" ? (
            <button className="start-btn" onClick={nextRound}>
              Next Round
            </button>
          ) : null}
          {state.isHost && state.status === "gameOver" ? (
            <button className="start-btn" onClick={nextRound}>
              Play Again
            </button>
          ) : null}
        </div>

        <h3 className="hand-title">
          Your Hand - {state.myHand.length} cards
          {myTurn && state.status === "playing" ? (
            <span className="your-turn"> - Your Turn</span>
          ) : null}
        </h3>

        <div className="my-hand">
          {state.myHand.length === 0 ? (
            <div className="empty-hand">No cards yet - waiting for the deal.</div>
          ) : (
            state.myHand.map((card) => {
              const playable =
                (state.playableCardIds || []).indexOf(card.id) !== -1;
              return (
                <CardFace
                  key={card.id}
                  card={card}
                  mode={playable ? "playable" : "hand"}
                  size="lg"
                  onClick={() => playCard(card)}
                />
              );
            })
          )}
        </div>
      </div>

      {pendingTrumpCard ? (
        <div className="modal-backdrop">
          <div className="trump-modal">
            <h2>Choose Trump</h2>
            <p>You can't follow suit. Pick a trump suit to declare.</p>
            <div className="trump-options">
              {["s", "h", "d", "c"].map((suit) => {
                const red = suit === "h" || suit === "d";
                return (
                  <button
                    key={suit}
                    className={red ? "red" : "black"}
                    onClick={() => chooseTrump(suit)}
                  >
                    {SUIT_SYMBOL[suit]}
                  </button>
                );
              })}
            </div>
            <button
              className="cancel-btn"
              onClick={() => setPendingTrumpCard(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
