import { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import "./App.css";

const socket = io("https://mendikot.onrender.com");

const SYM = { s: "♠", h: "♥", d: "♦", c: "♣" };
const SNAME = { s: "Spades", h: "Hearts", d: "Diamonds", c: "Clubs" };
const SCOLOR = { s: "black", h: "red", d: "red", c: "black" };

const SUITS = ["s", "h", "d", "c"];
const TARGET_SCORE = 10;

const VALUE_ORDER = {
  A: 14,
  K: 13,
  Q: 12,
  J: 11,
  "10": 10,
  9: 9,
  8: 8,
  7: 7,
  6: 6,
  5: 5,
  4: 4,
  3: 3,
  2: 2,
};

const SUIT_ORDER = { s: 1, h: 2, d: 3, c: 4 };

function sortCards(cards = []) {
  return [...cards].sort((a, b) => {
    if (SUIT_ORDER[a.s] !== SUIT_ORDER[b.s]) {
      return SUIT_ORDER[a.s] - SUIT_ORDER[b.s];
    }
    return VALUE_ORDER[a.v] - VALUE_ORDER[b.v];
  });
}

function teamOf(playerIndex) {
  return playerIndex % 2 === 0 ? 0 : 1;
}

function getPlayerNames(playerCount, playerName) {
  if (playerCount === 6) {
    return [playerName, "Bot 1", "Partner 1", "Bot 2", "Partner 2", "Bot 3"];
  }
  return [playerName, "Right Opp", "Partner", "Left Opp"];
}

function getRelativePosition(playerIndex, myIndex, playerCount) {
  if (playerCount === 6) {
    return [
      "bottom",
      "bottom-right",
      "top-right",
      "top",
      "top-left",
      "bottom-left",
    ][playerIndex];
  }

  const diff = (playerIndex - myIndex + 4) % 4;
  if (diff === 0) return "bottom";
  if (diff === 1) return "right";
  if (diff === 2) return "top";
  return "left";
}

function makeDeck(playerCount) {
  const values =
    playerCount === 6
      ? ["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"]
      : ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];

  const deck = [];

  for (const s of SUITS) {
    for (const v of values) {
      deck.push({
        id: `${s}-${v}-${crypto.randomUUID()}`,
        s,
        v,
      });
    }
  }

  return deck.sort(() => Math.random() - 0.5);
}

function createBotGame({
  playerCount = 4,
  playerName = "You",
  existingScores = [0, 0],
  dealer = 0,
} = {}) {
  const deck = makeDeck(playerCount);
  const cardsPerPlayer = deck.length / playerCount;
  const names = getPlayerNames(playerCount, playerName);

  const hands = Array.from({ length: playerCount }, (_, index) =>
    sortCards(deck.slice(index * cardsPerPlayer, (index + 1) * cardsPerPlayer))
  );

  const leader = (dealer + 1) % playerCount;

  return {
    isBotGame: true,
    roomCode: "BOT",
    playerCount,
    playerName,
    status: "playing",
    phase: "playing",
    myIndex: 0,

    dealer,
    leader,
    currentPlayer: leader,

    trump: null,
    trumpDeclaredBy: null,

    message: `${names[dealer]} shuffled. ${names[leader]} leads first card.`,

    scores: existingScores,
    tricksWon: [0, 0],
    tensWon: [0, 0],
    capturedTens: [[], []],

    trick: [],
    players: names.map((name, index) => ({ index, name })),

    hands,
    myHand: hands[0],
    handCounts: hands.map((h) => h.length),
  };
}

function getPlayableCards(hand, trick) {
  if (trick.length === 0) return hand;

  const ledSuit = trick[0].card.s;
  const followCards = hand.filter((card) => card.s === ledSuit);

  return followCards.length > 0 ? followCards : hand;
}

function needsTrumpDeclaration(state, playerIndex) {
  if (state.trump || state.trick.length === 0) return false;

  const ledSuit = state.trick[0].card.s;
  return !state.hands[playerIndex].some((card) => card.s === ledSuit);
}

function beatsCard(state, cardA, cardB) {
  const ledSuit = state.trick[0].card.s;

  if (state.trump) {
    const aTrump = cardA.s === state.trump;
    const bTrump = cardB.s === state.trump;

    if (aTrump && !bTrump) return true;
    if (!aTrump && bTrump) return false;
  }

  if (cardA.s === cardB.s) {
    return VALUE_ORDER[cardA.v] > VALUE_ORDER[cardB.v];
  }

  if (cardA.s === ledSuit && cardB.s !== ledSuit) return true;
  if (cardA.s !== ledSuit && cardB.s === ledSuit) return false;

  return false;
}

function getTrickWinner(state, trick = state.trick) {
  let best = trick[0];

  for (let i = 1; i < trick.length; i++) {
    const play = trick[i];
    const tempState = { ...state, trick };

    if (beatsCard(tempState, play.card, best.card)) {
      best = play;
    }
  }

  return best.playerIndex;
}

function isTen(card) {
  return card.v === "10";
}

function chooseBotTrump(hand) {
  const counts = { s: 0, h: 0, d: 0, c: 0 };

  for (const card of hand) {
    counts[card.s] += 1;
  }

  return SUITS.slice().sort((a, b) => counts[b] - counts[a])[0];
}

function botChooseCard(state, playerIndex) {
  const playable = getPlayableCards(state.hands[playerIndex], state.trick);

  if (playable.length === 1) return playable[0];

  if (state.trick.length === 0) {
    const nonTrump = state.trump
      ? playable.filter((card) => card.s !== state.trump)
      : playable;

    const options = nonTrump.length ? nonTrump : playable;
    return [...options].sort((a, b) => VALUE_ORDER[b.v] - VALUE_ORDER[a.v])[0];
  }

  const currentWinner = getTrickWinner(state);
  const partnerWinning = teamOf(currentWinner) === teamOf(playerIndex);

  if (partnerWinning) {
    return [...playable].sort((a, b) => VALUE_ORDER[a.v] - VALUE_ORDER[b.v])[0];
  }

  const winningCards = playable.filter((card) => {
    const tempTrick = [...state.trick, { playerIndex, card }];
    const tempState = { ...state, trick: tempTrick };
    return getTrickWinner(tempState, tempTrick) === playerIndex;
  });

  if (winningCards.length) {
    return [...winningCards].sort(
      (a, b) => VALUE_ORDER[a.v] - VALUE_ORDER[b.v]
    )[0];
  }

  const nonTrump = state.trump
    ? playable.filter((card) => card.s !== state.trump)
    : playable;

  const options = nonTrump.length ? nonTrump : playable;
  return [...options].sort((a, b) => VALUE_ORDER[a.v] - VALUE_ORDER[b.v])[0];
}

function formatCapturedTens(cards = []) {
  if (!cards.length) return "None";
  return cards.map((c) => `${SYM[c.s]}10`).join("  ");
}

function Card({ card, playable, onClick, small }) {
  return (
    <button
      type="button"
      className={`card ${SCOLOR[card.s]} ${playable ? "playable" : ""} ${
        isTen(card) ? "ten-card" : ""
      } ${small ? "small" : ""}`}
      onClick={playable ? onClick : undefined}
    >
      <div className="corner">
        <div>{card.v}</div>
        <div>{SYM[card.s]}</div>
      </div>

      <div className="center-suit">{SYM[card.s]}</div>

      <div className="corner bottom-corner">
        <div>{card.v}</div>
        <div>{SYM[card.s]}</div>
      </div>
    </button>
  );
}

function CardBack({ small }) {
  return <div className={`card-back ${small ? "small" : ""}`} />;
}

export default function App() {
  const [screen, setScreen] = useState("home");
  const [name, setName] = useState("You");
  const [joinCode, setJoinCode] = useState("");
  const [state, setState] = useState(null);
  const [error, setError] = useState("");
  const [pendingTrumpPlay, setPendingTrumpPlay] = useState(null);
  const [showTrumpModal, setShowTrumpModal] = useState(false);
  const [selectedBotPlayers, setSelectedBotPlayers] = useState(4);

  useEffect(() => {
    socket.on("state", (data) => {
      setState(data);
      setScreen("game");
      setError("");
    });

    socket.on("errorMessage", (msg) => {
      setError(msg);
    });

    socket.on("needTrump", ({ cardId }) => {
      setPendingTrumpPlay({ cardId });
      setShowTrumpModal(true);
    });

    return () => {
      socket.off("state");
      socket.off("errorMessage");
      socket.off("needTrump");
    };
  }, []);

  useEffect(() => {
    if (!state?.isBotGame) return;
    if (state.status !== "playing") return;
    if (state.phase !== "playing") return;
    if (state.currentPlayer === 0) return;

    const timer = setTimeout(() => {
      playBotTurn();
    }, 650);

    return () => clearTimeout(timer);
  }, [state]);

  useEffect(() => {
    if (!state?.isBotGame) return;
    if (state.phase !== "pause") return;

    const timer = setTimeout(() => {
      resolvePausedTrick();
    }, 900);

    return () => clearTimeout(timer);
  }, [state]);

  const isMyTurn =
    state?.status === "playing" &&
    state.phase === "playing" &&
    state.currentPlayer === state.myIndex;

  const sortedMyHand = useMemo(() => {
    return sortCards(state?.myHand || []);
  }, [state?.myHand]);

  const playableIds = useMemo(() => {
    if (!state || !isMyTurn) return new Set();

    if (state.isBotGame) {
      return new Set(
        getPlayableCards(state.myHand || [], state.trick || []).map((c) => c.id)
      );
    }

    const hand = state.myHand || [];

    if (state.trick.length === 0) return new Set(hand.map((c) => c.id));

    const ledSuit = state.trick[0].card.s;
    const follow = hand.filter((c) => c.s === ledSuit);

    return new Set((follow.length ? follow : hand).map((c) => c.id));
  }, [state, isMyTurn]);

  function createRoom() {
    if (!name.trim()) {
      setError("Please enter your name.");
      return;
    }

    socket.emit("createRoom", { name: name.trim() });
  }

  function joinRoom() {
    if (!name.trim()) {
      setError("Please enter your name.");
      return;
    }

    if (!joinCode.trim()) {
      setError("Please enter room code.");
      return;
    }

    socket.emit("joinRoom", {
      roomCode: joinCode.trim().toUpperCase(),
      name: name.trim(),
    });
  }

  function startGame() {
    socket.emit("startGame", { roomCode: state.roomCode });
  }

  function applyPlayedCard(prev, playerIndex, card) {
    const updatedHands = prev.hands.map((hand, index) =>
      index === playerIndex ? hand.filter((c) => c.id !== card.id) : hand
    );

    const updatedTrick = [...prev.trick, { playerIndex, card }];
    const updatedHandCounts = updatedHands.map((hand) => hand.length);

    const nextState = {
      ...prev,
      hands: updatedHands,
      myHand: updatedHands[0],
      handCounts: updatedHandCounts,
      trick: updatedTrick,
      message:
        playerIndex === 0
          ? "You played a card."
          : `${prev.players[playerIndex].name} played a card.`,
    };

    if (updatedTrick.length < prev.playerCount) {
      return {
        ...nextState,
        currentPlayer: (playerIndex + 1) % prev.playerCount,
      };
    }

    const winner = getTrickWinner(nextState, updatedTrick);
    const winnerTeam = teamOf(winner);

    const updatedTricksWon = [...prev.tricksWon];
    const updatedTensWon = [...prev.tensWon];
    const updatedCapturedTens = prev.capturedTens.map((cards) => [...cards]);

    updatedTricksWon[winnerTeam] += 1;

    for (const play of updatedTrick) {
      if (isTen(play.card)) {
        updatedTensWon[winnerTeam] += 1;
        updatedCapturedTens[winnerTeam].push(play.card);
      }
    }

    return {
      ...nextState,
      phase: "pause",
      currentPlayer: winner,
      tricksWon: updatedTricksWon,
      tensWon: updatedTensWon,
      capturedTens: updatedCapturedTens,
      message:
        winner === 0
          ? "You won the trick!"
          : `${prev.players[winner].name} won the trick!`,
    };
  }

  function resolvePausedTrick() {
    setState((prev) => {
      if (!prev?.isBotGame || prev.phase !== "pause") return prev;

      const roundFinished = prev.hands[0].length === 0;

      if (!roundFinished) {
        return {
          ...prev,
          trick: [],
          phase: "playing",
          message:
            prev.currentPlayer === 0
              ? "Your turn."
              : `${prev.players[prev.currentPlayer].name} leads.`,
        };
      }

      let pointsTeam0 = 0;
      let pointsTeam1 = 0;
      let roundWinnerTeam = null;
      let reason = "";

      if (prev.tensWon[0] > prev.tensWon[1]) {
        roundWinnerTeam = 0;
        pointsTeam0 = 1;
        reason = `Your team won more Mendies/10s: ${prev.tensWon[0]} - ${prev.tensWon[1]}.`;
      } else if (prev.tensWon[1] > prev.tensWon[0]) {
        roundWinnerTeam = 1;
        pointsTeam1 = 1;
        reason = `Opposition won more Mendies/10s: ${prev.tensWon[1]} - ${prev.tensWon[0]}.`;
      } else if (prev.tricksWon[0] > prev.tricksWon[1]) {
        roundWinnerTeam = 0;
        pointsTeam0 = 1;
        reason = `Both teams got 2 Mendies/10s. Your team won more tricks: ${prev.tricksWon[0]} - ${prev.tricksWon[1]}.`;
      } else {
        roundWinnerTeam = 1;
        pointsTeam1 = 1;
        reason = `Both teams got 2 Mendies/10s. Opposition won more tricks: ${prev.tricksWon[1]} - ${prev.tricksWon[0]}.`;
      }

      if (prev.tensWon[0] === 4) {
        pointsTeam0 = 2;
        pointsTeam1 = 0;
        roundWinnerTeam = 0;
        reason = "Mendikot! Your team captured all four 10s.";
      }

      if (prev.tensWon[1] === 4) {
        pointsTeam1 = 2;
        pointsTeam0 = 0;
        roundWinnerTeam = 1;
        reason = "Mendikot! Opposition captured all four 10s.";
      }

      const updatedScores = [
        prev.scores[0] + pointsTeam0,
        prev.scores[1] + pointsTeam1,
      ];

      const dealerTeam = teamOf(prev.dealer);

      const nextDealer =
        dealerTeam === roundWinnerTeam
          ? (prev.dealer + 1) % prev.playerCount
          : prev.dealer;

      return {
        ...prev,
        trick: [],
        scores: updatedScores,
        status:
          updatedScores[0] >= TARGET_SCORE || updatedScores[1] >= TARGET_SCORE
            ? "gameOver"
            : "roundOver",
        phase: "roundOver",
        roundWinnerTeam,
        nextDealer,
        message: reason,
      };
    });
  }

  function playBotTurn() {
    setState((prev) => {
      if (!prev?.isBotGame) return prev;
      if (prev.currentPlayer === 0) return prev;
      if (prev.phase !== "playing") return prev;

      const playerIndex = prev.currentPlayer;

      if (needsTrumpDeclaration(prev, playerIndex)) {
        const trumpSuit = chooseBotTrump(prev.hands[playerIndex]);

        return {
          ...prev,
          trump: trumpSuit,
          trumpDeclaredBy: playerIndex,
          message: `${prev.players[playerIndex].name} declared trump: ${SYM[trumpSuit]} ${SNAME[trumpSuit]}`,
        };
      }

      const card = botChooseCard(prev, playerIndex);
      return applyPlayedCard(prev, playerIndex, card);
    });
  }

  function playCard(cardId) {
    if (state?.isBotGame) {
      setState((prev) => {
        if (!prev || prev.currentPlayer !== 0 || prev.phase !== "playing") {
          return prev;
        }

        const card = prev.hands[0].find((c) => c.id === cardId);
        if (!card) return prev;

        const playableCards = getPlayableCards(prev.hands[0], prev.trick);
        const isPlayable = playableCards.some((c) => c.id === cardId);

        if (!isPlayable) return prev;

        if (needsTrumpDeclaration(prev, 0)) {
          setPendingTrumpPlay({ playerIndex: 0, card });
          setShowTrumpModal(true);
          return prev;
        }

        return applyPlayedCard(prev, 0, card);
      });

      return;
    }

    socket.emit("playCard", {
      roomCode: state.roomCode,
      cardId,
    });
  }

  function chooseTrump(suit) {
    if (state?.isBotGame) {
      setShowTrumpModal(false);

      setState((prev) => {
        if (!prev || !pendingTrumpPlay?.card) return prev;

        const updated = {
          ...prev,
          trump: suit,
          trumpDeclaredBy: pendingTrumpPlay.playerIndex,
          message: `You declared trump: ${SYM[suit]} ${SNAME[suit]}`,
        };

        return applyPlayedCard(
          updated,
          pendingTrumpPlay.playerIndex,
          pendingTrumpPlay.card
        );
      });

      setPendingTrumpPlay(null);
      return;
    }

    setShowTrumpModal(false);

    socket.emit("playCard", {
      roomCode: state.roomCode,
      cardId: pendingTrumpPlay?.cardId,
      selectedTrump: suit,
    });

    setPendingTrumpPlay(null);
  }

  function nextRound() {
    if (state?.isBotGame) {
      const dealerToUse =
        typeof state.nextDealer === "number" ? state.nextDealer : state.dealer;

      const next = createBotGame({
        playerCount: state.playerCount,
        playerName: state.playerName,
        existingScores: state.scores,
        dealer: dealerToUse,
      });

      setState(next);
      return;
    }

    socket.emit("nextRound", { roomCode: state.roomCode });
  }

  function goHome() {
    setState(null);
    setScreen("home");
    setError("");
    setShowTrumpModal(false);
    setPendingTrumpPlay(null);
  }

  if (screen === "home") {
    return (
      <div className="app home">
        <div className="home-card">
          <h1>Mendikot</h1>

          <input
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

          <button onClick={() => setScreen("botMode")}>Play With Bots</button>

          <button className="secondary" onClick={() => setScreen("multiplayer")}>
            Multiplayer
          </button>

          {error && <div className="error">{error}</div>}
        </div>
      </div>
    );
  }

  if (screen === "botMode") {
    return (
      <div className="app home">
        <div className="home-card">
          <h1>Bot Mode</h1>

          <button
            className={selectedBotPlayers === 4 ? "" : "secondary"}
            onClick={() => setSelectedBotPlayers(4)}
          >
            4 Players
          </button>

          <button
            className={selectedBotPlayers === 6 ? "" : "secondary"}
            onClick={() => setSelectedBotPlayers(6)}
          >
            6 Players
          </button>

          <div className="divider">OR</div>

          <button
            onClick={() => {
              const newGame = createBotGame({
                playerCount: selectedBotPlayers,
                playerName: name.trim() || "You",
                existingScores: [0, 0],
                dealer: 0,
              });

              setState(newGame);
              setScreen("game");
              setError("");
            }}
          >
            Start Bot Game
          </button>

          <button className="secondary" onClick={() => setScreen("home")}>
            Back
          </button>

          {error && <div className="error">{error}</div>}
        </div>
      </div>
    );
  }

  if (screen === "multiplayer") {
    return (
      <div className="app home">
        <div className="home-card">
          <h1>Mendikot Multiplayer</h1>

          <input
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

          <button onClick={createRoom}>Create Room</button>

          <div className="divider">OR</div>

          <input
            placeholder="Room code"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
          />

          <button className="secondary" onClick={joinRoom}>
            Join Room
          </button>

          <button className="secondary" onClick={() => setScreen("home")}>
            Back
          </button>

          {error && <div className="error">{error}</div>}
        </div>
      </div>
    );
  }

  if (!state) return null;

  return (
    <div className="app">
      <div className="header">
        <div className="score">
          <div className="label">
            {state.isBotGame
              ? state.playerCount === 6
                ? "YOUR TEAM 0·2·4"
                : "YOU & PARTNER"
              : "TEAM 1"}
          </div>

          <div className="score-value">{state.scores[0]}</div>

          <div className="sub">
            {state.tricksWon[0]} tricks · {state.tensWon[0]} tens
          </div>
        </div>

        <div className="center-info">
          <div className="room">
            Shuffler: {state.players?.[state.dealer]?.name || "-"} · Lead:{" "}
            {state.players?.[state.leader]?.name || "-"}
          </div>

          <div className="trump">
            Trump:{" "}
            {state.trump ? (
              <span className={SCOLOR[state.trump]}>
                {SYM[state.trump]} {SNAME[state.trump]}
              </span>
            ) : (
              "Hidden"
            )}
          </div>

          <div className="message">{state.message}</div>
        </div>

        <div className="score">
          <div className="label">OPPOSITION</div>
          <div className="score-value">{state.scores[1]}</div>
          <div className="sub">
            {state.tricksWon[1]} tricks · {state.tensWon[1]} tens
          </div>
        </div>
      </div>

      {state.status === "waiting" ? (
        <div className="waiting-panel">
          <h2>Waiting for Players</h2>

          <div className="big-code">{state.roomCode}</div>

          <div className="player-list">
            {state.players.map((p) => (
              <div key={p.index}>
                Player {p.index + 1}: {p.name}
              </div>
            ))}
          </div>

          {state.isHost ? (
            <button disabled={state.players.length !== 4} onClick={startGame}>
              Start Game
            </button>
          ) : (
            <p>Waiting for host to start...</p>
          )}
        </div>
      ) : (
        <div className="table">
          <div className="mendi-panel">
            <div>
              <strong>Your Team</strong>
              <span>{state.tensWon[0]} tens</span>
              <small>{formatCapturedTens(state.capturedTens?.[0])}</small>
              <small>{state.tricksWon[0]} tricks won</small>
            </div>

            <div>
              <strong>Opposition</strong>
              <span>{state.tensWon[1]} tens</span>
              <small>{formatCapturedTens(state.capturedTens?.[1])}</small>
              <small>{state.tricksWon[1]} tricks won</small>
            </div>
          </div>

          {state.players.map((p) => {
            const position = getRelativePosition(
              p.index,
              state.myIndex,
              state.playerCount || 4
            );

            const isVertical = position === "left" || position === "right";
            const isSmall =
              state.playerCount === 6 && p.index !== 0 && p.index !== 3;

            return (
              <div
                key={p.index}
                className={`player-zone ${position} ${
                  state.currentPlayer === p.index && state.status === "playing"
                    ? "active"
                    : ""
                }`}
              >
                <div className="player-name">
                  {p.index === state.myIndex ? `${p.name} (You)` : p.name}

                  <span className="team-badge">Team {teamOf(p.index) + 1}</span>

                  {p.index === state.dealer && (
                    <span className="bot-badge">Shuffler</span>
                  )}
                </div>

                {p.index === state.myIndex ? (
                  <div className="hand my-hand">
                    {sortedMyHand.map((card) => (
                      <Card
                        key={card.id}
                        card={card}
                        playable={playableIds.has(card.id)}
                        onClick={() => playCard(card.id)}
                      />
                    ))}
                  </div>
                ) : (
                  <div
                    className={`hand back-hand ${isVertical ? "vertical" : ""}`}
                  >
                    {Array.from({
                      length: state.handCounts[p.index],
                    }).map((_, i) => (
                      <CardBack key={i} small={isSmall || isVertical} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          <div className="trick-area">
            <div className="trick-grid">
              <div className="trick-center">
                {isMyTurn ? "Your Turn" : "Mendikot"}
              </div>

              {state.trick.map((t) => {
                const position = getRelativePosition(
                  t.playerIndex,
                  state.myIndex,
                  state.playerCount || 4
                );

                return (
                  <div
                    key={`${t.playerIndex}-${t.card.id}`}
                    className={`trick-slot trick-${position}`}
                  >
                    <Card card={t.card} small />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {showTrumpModal && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>Choose Trump</h2>
            <p>You cannot follow the led suit. Select trump.</p>

            <div className="suit-grid">
              {["s", "h", "d", "c"].map((s) => (
                <button
                  key={s}
                  className={`suit-button ${SCOLOR[s]}`}
                  onClick={() => chooseTrump(s)}
                >
                  <div>{SYM[s]}</div>
                  <small>{SNAME[s]}</small>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {(state.status === "roundOver" || state.status === "gameOver") && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>{state.status === "gameOver" ? "Game Over" : "Round Over"}</h2>

            <p>{state.message}</p>

            <div className="round-score">
              <div>
                Your Team: {state.scores[0]}
                <br />
                Tens: {formatCapturedTens(state.capturedTens?.[0])}
                <br />
                Tricks: {state.tricksWon[0]}
              </div>

              <div>
                Opposition: {state.scores[1]}
                <br />
                Tens: {formatCapturedTens(state.capturedTens?.[1])}
                <br />
                Tricks: {state.tricksWon[1]}
              </div>
            </div>

            {state.status === "gameOver" ? (
              <button onClick={goHome}>Home</button>
            ) : (
              <button onClick={nextRound}>Next Round</button>
            )}

            <button className="secondary" onClick={goHome}>
              Home
            </button>
          </div>
        </div>
      )}

      {error && <div className="toast">{error}</div>}
    </div>
  );
}