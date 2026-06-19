import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { socket } from "../socket";
import { getAvatar } from "../avatars";

export default function LobbyPage() {
  const { roomCode } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const stateRef = useRef(null);
  const code = (roomCode || "").toUpperCase();
  const playerName = localStorage.getItem("playerName");

  useEffect(() => { stateRef.current = state; }, [state]);

  useEffect(() => {
    if (!playerName) { navigate("/"); return; }
    if (!/^[A-Z0-9]{5}$/.test(code)) { navigate("/"); return; }

    const tokenKey = "token:" + code;
    const avatar = getAvatar();

    const attemptJoin = () => {
      const token = localStorage.getItem(tokenKey) || null;
      socket.emit("reconnectPlayer", { roomCode: code, name: playerName, token, avatar });
    };

    const handleState = (s) => {
      setState(s);
      setError("");
      if (s.status !== "waiting") navigate("/room/" + s.roomCode);
    };
    const handleError = (msg) => setError(typeof msg === "string" ? msg : "Server error.");
    const handleSession = (data) => {
      if (data?.roomCode && data?.token) localStorage.setItem("token:" + data.roomCode, data.token);
    };
    const handleReconnectFailed = () => socket.emit("joinRoom", { roomCode: code, name: playerName, avatar });
    const handleConnect = () => attemptJoin();
    const handleDisconnect = () => setToast("Disconnected — reconnecting...");

    socket.on("state", handleState);
    socket.on("errorMessage", handleError);
    socket.on("session", handleSession);
    socket.on("reconnectFailed", handleReconnectFailed);
    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);

    if (socket.connected) attemptJoin();

    const fallback = setTimeout(() => {
      if (!stateRef.current) socket.emit("joinRoom", { roomCode: code, name: playerName, avatar });
    }, 700);

    return () => {
      clearTimeout(fallback);
      socket.off("state", handleState);
      socket.off("errorMessage", handleError);
      socket.off("session", handleSession);
      socket.off("reconnectFailed", handleReconnectFailed);
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
    };
  }, [code, playerName, navigate]);

  useEffect(() => {
    if (state && toast.includes("Disconnected")) setToast("");
  }, [state, toast]);

  const copyInvite = async () => {
    const url = window.location.origin + "/room/" + code + "/lobby";
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(url);
      } else {
        const ta = document.createElement("textarea");
        ta.value = url;
        ta.style.cssText = "position:fixed;opacity:0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setToast("Link copied!");
      setTimeout(() => setToast(""), 1800);
    } catch {
      setToast("Copy the URL from the address bar.");
      setTimeout(() => setToast(""), 2500);
    }
  };

  const leaveRoom   = () => { socket.emit("leaveRoom"); navigate("/"); };
  const startGame   = () => socket.emit("startGame", { roomCode: code });
  const fillWithBots = () => socket.emit("fillWithBots", { roomCode: code });
  const moveToLobby = (playerIndex, lobby) =>
    socket.emit("joinLobby", { roomCode: code, targetPlayerIndex: playerIndex, lobby });

  if (!state) {
    return (
      <div className="lobby-page">
        <div className="loading-card">
          <h2>Connecting to room...</h2>
          <p>Room: {code}</p>
          {error && <div className="error-box">{error}</div>}
          <button className="secondary-btn" style={{ marginTop: 16 }} onClick={() => navigate("/")}>
            Back to home
          </button>
        </div>
      </div>
    );
  }

  const teamSize = state.playerCount / 2;
  const lobby1 = state.players.filter((p) => p.lobby === 1);
  const lobby2 = state.players.filter((p) => p.lobby === 2);
  const canStart =
    state.isHost &&
    state.players.length === state.playerCount &&
    lobby1.length === teamSize &&
    lobby2.length === teamSize;

  const renderCard = (player, inLobby) => {
    const isMe = player.index === state.myIndex;
    const isHostPlayer = player.index === state.hostIndex;
    const canControl = state.isHost || isMe;

    return (
      <div
        key={player.index}
        className={"lpc" + (isMe ? " lpc-me" : "") + (!player.connected ? " lpc-offline" : "")}
      >
        <div className="lpc-arrow">
          {inLobby === 2 && canControl && (
            <button
              className="lobby-arrow"
              onClick={() => moveToLobby(player.index, 1)}
              title="Move to Lobby 1"
              aria-label="Move left to Lobby 1"
            >
              ‹
            </button>
          )}
        </div>

        <div className="lpc-body">
          <div className="lpc-avatar">{player.isBot ? "🤖" : (player.avatar || "👤")}</div>
          <div className="lpc-info">
            <span className="lpc-name">
              {player.name}
              {isMe ? " (You)" : ""}
            </span>
            <div className="lpc-tags">
              {isMe && <span className="tag you">You</span>}
              {isHostPlayer && <span className="tag host">Host</span>}
              {player.isBot && <span className="tag bot">Bot</span>}
              {!player.connected && <span className="tag off">Offline</span>}
            </div>
          </div>
        </div>

        <div className="lpc-arrow lpc-arrow-right">
          {inLobby === 1 && canControl && (
            <button
              className="lobby-arrow"
              onClick={() => moveToLobby(player.index, 2)}
              title="Move to Lobby 2"
              aria-label="Move right to Lobby 2"
            >
              ›
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderEmpty = (key) => (
    <div key={key} className="lpc lpc-empty">
      <div className="lpc-arrow" />
      <div className="lpc-body">
        <div className="lpc-avatar empty-avatar">?</div>
        <div className="lpc-info">
          <span className="lpc-name empty-name">Waiting for player...</span>
        </div>
      </div>
      <div className="lpc-arrow" />
    </div>
  );

  const emptySlots1 = Math.max(0, teamSize - lobby1.length);
  const emptySlots2 = Math.max(0, teamSize - lobby2.length);

  return (
    <div className="lobby-page">
      <header className="lobby-header">
        <div className="lobby-brand">♠ Mendikot</div>
        <div className="lobby-room-info">
          <span className="lobby-room-label">Room</span>
          <span className="lobby-room-code">{code}</span>
        </div>
        <div className="lobby-header-actions">
          <button className="lh-btn" onClick={copyInvite}>Copy Link</button>
          <button className="lh-btn lh-btn-leave" onClick={leaveRoom}>Leave</button>
        </div>
      </header>

      {error && <div className="error-box lobby-error">{error}</div>}

      <div className="lobby-status-bar">
        <span className="lobby-player-count">
          {state.players.length} / {state.playerCount} players
        </span>
        <span className="lobby-mode-badge">
          {state.mode === "6p" ? "6 Player" : "4 Player"}
        </span>
        {state.message && <span className="lobby-msg">{state.message}</span>}
      </div>

      <div className="lobby-arena">
        <div className="lobby-panel lobby-panel-1">
          <div className="lp-header">
            <div className="lp-title">
              <span className="lp-dot dot-1" />
              Lobby 1
            </div>
            <div className="lp-count">{lobby1.length} / {teamSize}</div>
          </div>
          <div className="lp-players">
            {lobby1.map((p) => renderCard(p, 1))}
            {Array.from({ length: emptySlots1 }).map((_, i) => renderEmpty("e1-" + i))}
          </div>
        </div>

        <div className="lobby-vs">
          <div className="vs-circle">VS</div>
          <div className="vs-line" />
        </div>

        <div className="lobby-panel lobby-panel-2">
          <div className="lp-header">
            <div className="lp-title">
              <span className="lp-dot dot-2" />
              Lobby 2
            </div>
            <div className="lp-count">{lobby2.length} / {teamSize}</div>
          </div>
          <div className="lp-players">
            {lobby2.map((p) => renderCard(p, 2))}
            {Array.from({ length: emptySlots2 }).map((_, i) => renderEmpty("e2-" + i))}
          </div>
        </div>
      </div>

      <div className="lobby-footer">
        {state.isHost ? (
          <>
            {state.players.length < state.playerCount && (
              <button className="lh-btn fill-bots-btn" onClick={fillWithBots}>
                + Fill Empty Seats with Bots
              </button>
            )}
            {!canStart && (
              <p className="lobby-hint">
                {state.players.length < state.playerCount
                  ? `Waiting for ${state.playerCount - state.players.length} more player${state.playerCount - state.players.length > 1 ? "s" : ""}…`
                  : "Balance both lobbies equally to start."}
              </p>
            )}
            <button className="start-btn lobby-start-btn" onClick={startGame} disabled={!canStart}>
              Start Game
            </button>
          </>
        ) : (
          <p className="lobby-hint">Waiting for the host to start the game...</p>
        )}
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
