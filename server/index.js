const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const PORT = process.env.PORT || 5000;

const SUITS = ["s", "h", "d", "c"];
const SYM = { s: "♠", h: "♥", d: "♦", c: "♣" };

const VALS = ["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];

const RANK = {
  3: 3,
  4: 4,
  5: 5,
  6: 6,
  7: 7,
  8: 8,
  9: 9,
  10: 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

const rooms = {};
const socketRoomMap = new Map();

function cleanName(name) {
  const value = String(name || "").trim();
  return value.length ? value.slice(0, 20) : "Player";
}

function cleanRoomCode(roomCode) {
  return String(roomCode || "").trim().toUpperCase();
}

function createRoomCode() {
  let code;
  do {
    code = Math.random().toString(36).substring(2, 7).toUpperCase();
  } while (rooms[code]);

  return code;
}

function playerCountFromMode(mode) {
  return mode === "6p" ? 6 : 4;
}

function teamOf(index) {
  return index % 2;
}

function makeDeck() {
  const deck = [];

  for (const s of SUITS) {
    for (const v of VALS) {
      deck.push({
        s,
        v,
        id: `${s}${v}`,
      });
    }
  }

  return deck;
}

function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  return deck;
}

function sortHand(hand) {
  const suitOrder = { s: 1, h: 2, d: 3, c: 4 };

  return [...hand].sort((a, b) => {
    if (suitOrder[a.s] !== suitOrder[b.s]) {
      return suitOrder[a.s] - suitOrder[b.s];
    }

    return RANK[a.v] - RANK[b.v];
  });
}

function rank(card) {
  return RANK[card.v];
}

function isTen(card) {
  return card.v === "10";
}

function getPlayable(room, playerIndex) {
  const hand = room.hands[playerIndex] || [];

  if (room.trick.length === 0) return hand;

  const ledSuit = room.trick[0].card.s;
  const followSuitCards = hand.filter((c) => c.s === ledSuit);

  return followSuitCards.length > 0 ? followSuitCards : hand;
}

function canFollowLedSuit(room, playerIndex) {
  if (room.trick.length === 0) return true;

  const ledSuit = room.trick[0].card.s;
  const hand = room.hands[playerIndex] || [];

  return hand.some((c) => c.s === ledSuit);
}

function beats(room, a, b) {
  const ledSuit = room.trick[0].card.s;

  if (room.trump) {
    const aTrump = a.s === room.trump;
    const bTrump = b.s === room.trump;

    if (aTrump && !bTrump) return true;
    if (!aTrump && bTrump) return false;
  }

  if (a.s === b.s) {
    return rank(a) > rank(b);
  }

  if (a.s === ledSuit && b.s !== ledSuit) {
    return true;
  }

  return false;
}

function trickWinner(room) {
  let best = room.trick[0];

  for (let i = 1; i < room.trick.length; i++) {
    if (beats(room, room.trick[i].card, best.card)) {
      best = room.trick[i];
    }
  }

  return best.playerIndex;
}

function createBaseRoom({ hostSocketId, hostName, mode = "4p", isBotGame = false }) {
  const code = createRoomCode();

  const room = {
    code,
    mode,
    playerCount: playerCountFromMode(mode),
    isBotGame,
    hostSocketId,
    status: "waiting",

    players: [],
    hands: [],
    trick: [],

    dealer: 0,
    leader: 0,
    currentPlayer: 0,
    trump: null,

    scores: [0, 0],
    tricksWon: [0, 0],
    tensWon: [0, 0],

    message: "Waiting for players...",
    botTimer: null,
  };

  room.players.push({
    socketId: hostSocketId,
    name: cleanName(hostName),
    index: 0,
    connected: true,
    isBot: false,
  });

  rooms[code] = room;
  socketRoomMap.set(hostSocketId, code);

  return room;
}

function publicState(room, socketId) {
  const me = room.players.find((p) => p.socketId === socketId);
  const myIndex = me ? me.index : 0;

  return {
    roomCode: room.code,
    mode: room.mode,
    playerCount: room.playerCount,
    isBotGame: room.isBotGame,
    status: room.status,

    players: room.players.map((p) => ({
      index: p.index,
      name: p.name,
      connected: p.connected,
      isBot: p.isBot,
    })),

    myIndex,
    myHand: sortHand(room.hands[myIndex] || []),
    handCounts: room.hands.map((h) => h.length),

    trick: room.trick,
    currentPlayer: room.currentPlayer,
    leader: room.leader,
    trump: room.trump,

    scores: room.scores,
    tricksWon: room.tricksWon,
    tensWon: room.tensWon,

    message: room.message,
    isHost: socketId === room.hostSocketId,
  };
}

function sendRoomState(roomCode) {
  const code = cleanRoomCode(roomCode);
  const room = rooms[code];

  if (!room) return;

  for (const p of room.players) {
    if (!p.isBot && p.socketId) {
      io.to(p.socketId).emit("state", publicState(room, p.socketId));
    }
  }
}

function startGame(room) {
  if (!room) return;

  if (room.players.length !== room.playerCount) {
    room.message = `Need ${room.playerCount} players to start.`;
    return;
  }

  if (room.players.some((p) => !p.connected && !p.isBot)) {
    room.message = "All real players must be connected before starting.";
    return;
  }

  room.status = "playing";
  room.trump = null;
  room.trick = [];
  room.tricksWon = [0, 0];
  room.tensWon = [0, 0];

  const deck = shuffle(makeDeck());
  const cardsPerPlayer = deck.length / room.playerCount;

  room.hands = Array.from({ length: room.playerCount }, (_, i) => {
    const cards = deck.slice(i * cardsPerPlayer, i * cardsPerPlayer + cardsPerPlayer);
    return sortHand(cards);
  });

  room.leader = (room.dealer + 1) % room.playerCount;
  room.currentPlayer = room.leader;

  room.message = `${room.players[room.currentPlayer].name} starts. Trump is hidden.`;
}

function endRound(room) {
  room.status = "roundOver";

  const t0 = room.tricksWon[0];
  const t1 = room.tricksWon[1];
  const totalTricks = t0 + t1;

  if (t0 === totalTricks) {
    room.scores[0] += 2;
    room.message = "Team 1 got Mendikot! +2 points.";
  } else if (t1 === totalTricks) {
    room.scores[1] += 2;
    room.message = "Team 2 got Mendikot! +2 points.";
  } else if (t0 > t1) {
    room.scores[0] += 1;
    room.message = "Team 1 won the round. +1 point.";
  } else {
    room.scores[1] += 1;
    room.message = "Team 2 won the round. +1 point.";
  }
}

function resolveTrick(room) {
  if (!room || room.trick.length === 0) return;

  const winnerIndex = trickWinner(room);
  const team = teamOf(winnerIndex);

  room.tricksWon[team] += 1;

  for (const item of room.trick) {
    if (isTen(item.card)) {
      room.tensWon[team] += 1;
    }
  }

  room.trick = [];
  room.currentPlayer = winnerIndex;
  room.leader = winnerIndex;

  room.message = `${room.players[winnerIndex].name} won the trick.`;

  const roundOver = room.hands.every((h) => h.length === 0);

  if (roundOver) {
    endRound(room);
  }
}

function currentWinnerIndex(room) {
  if (room.trick.length === 0) return null;
  return trickWinner(room);
}

function wouldWin(room, playerIndex, card) {
  const fakeRoom = {
    ...room,
    trick: [...room.trick, { playerIndex, card }],
  };

  return trickWinner(fakeRoom) === playerIndex;
}

function lowest(cards) {
  return [...cards].sort((a, b) => rank(a) - rank(b))[0];
}

function highest(cards) {
  return [...cards].sort((a, b) => rank(b) - rank(a))[0];
}

function chooseBotTrump(room, playerIndex) {
  const hand = room.hands[playerIndex] || [];
  const counts = { s: 0, h: 0, d: 0, c: 0 };

  for (const c of hand) {
    counts[c.s]++;
  }

  return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
}

function chooseBotMove(room, playerIndex) {
  const playable = getPlayable(room, playerIndex);
  const myTeam = teamOf(playerIndex);

  let selectedTrump = null;

  const cannotFollow =
    room.trick.length > 0 && !canFollowLedSuit(room, playerIndex);

  if (!room.trump && cannotFollow) {
    selectedTrump = chooseBotTrump(room, playerIndex);
  }

  if (playable.length === 1) {
    return {
      card: playable[0],
      selectedTrump,
    };
  }

  if (room.trick.length === 0) {
    const nonTrump = room.trump
      ? playable.filter((c) => c.s !== room.trump)
      : playable;

    if (nonTrump.length > 0) {
      return {
        card: highest(nonTrump),
        selectedTrump,
      };
    }

    return {
      card: lowest(playable),
      selectedTrump,
    };
  }

  const winningPlayer = currentWinnerIndex(room);
  const partnerWinning =
    winningPlayer !== null && teamOf(winningPlayer) === myTeam;

  if (partnerWinning) {
    return {
      card: lowest(playable),
      selectedTrump,
    };
  }

  const winningCards = playable.filter((c) => wouldWin(room, playerIndex, c));

  if (winningCards.length > 0) {
    return {
      card: lowest(winningCards),
      selectedTrump,
    };
  }

  const nonTrump = room.trump
    ? playable.filter((c) => c.s !== room.trump)
    : playable;

  return {
    card: lowest(nonTrump.length > 0 ? nonTrump : playable),
    selectedTrump,
  };
}

function playCardCore(room, playerIndex, cardId, selectedTrump) {
  if (!room || room.status !== "playing") {
    return {
      ok: false,
      error: "Game is not active.",
    };
  }

  if (room.trick.some((t) => t.playerIndex === playerIndex)) {
    return {
      ok: false,
      error: "You have already played in this trick.",
    };
  }

  if (room.currentPlayer !== playerIndex) {
    return {
      ok: false,
      error: "It is not your turn.",
    };
  }

  const hand = room.hands[playerIndex] || [];
  const card = hand.find((c) => c.id === cardId);

  if (!card) {
    return {
      ok: false,
      error: "Card not found.",
    };
  }

  const playable = getPlayable(room, playerIndex);

  if (!playable.some((c) => c.id === cardId)) {
    return {
      ok: false,
      error: "You must follow suit.",
    };
  }

  const cannotFollow =
    room.trick.length > 0 && !canFollowLedSuit(room, playerIndex);

  if (!room.trump && cannotFollow) {
    if (!selectedTrump) {
      return {
        ok: false,
        needTrump: true,
        cardId,
      };
    }

    if (!SUITS.includes(selectedTrump)) {
      return {
        ok: false,
        error: "Invalid trump.",
      };
    }

    room.trump = selectedTrump;
    room.message = `${room.players[playerIndex].name} declared trump: ${SYM[selectedTrump]}`;
  }

  room.hands[playerIndex] = sortHand(hand.filter((c) => c.id !== cardId));

  room.trick.push({
    playerIndex,
    playerName: room.players[playerIndex].name,
    card,
  });

  if (room.trick.length === room.playerCount) {
    return {
      ok: true,
      trickComplete: true,
    };
  }

  room.currentPlayer = (room.currentPlayer + 1) % room.playerCount;
  room.message = `${room.players[room.currentPlayer].name}'s turn.`;

  return {
    ok: true,
  };
}

function runBots(roomCode) {
  const code = cleanRoomCode(roomCode);
  const room = rooms[code];

  if (!room || room.status !== "playing") return;

  const current = room.players[room.currentPlayer];

  if (!current || !current.isBot) return;

  clearTimeout(room.botTimer);

  room.botTimer = setTimeout(() => {
    const freshRoom = rooms[code];

    if (!freshRoom || freshRoom.status !== "playing") return;

    const bot = freshRoom.players[freshRoom.currentPlayer];

    if (!bot || !bot.isBot) return;

    const move = chooseBotMove(freshRoom, bot.index);

    const result = playCardCore(
      freshRoom,
      bot.index,
      move.card.id,
      move.selectedTrump
    );

    sendRoomState(code);

    if (result.trickComplete) {
      setTimeout(() => {
        resolveTrick(freshRoom);
        sendRoomState(code);
        runBots(code);
      }, 1000);
    } else {
      runBots(code);
    }
  }, 800);
}

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  socket.on("createRoom", ({ name } = {}) => {
    const existingCode = socketRoomMap.get(socket.id);

    if (existingCode && rooms[existingCode]) {
      socket.emit("errorMessage", "You are already inside a room.");
      sendRoomState(existingCode);
      return;
    }

    const room = createBaseRoom({
      hostSocketId: socket.id,
      hostName: cleanName(name),
      mode: "4p",
      isBotGame: false,
    });

    socket.join(room.code);
    sendRoomState(room.code);
  });

  socket.on("createBotGame", ({ name, mode } = {}) => {
    const existingCode = socketRoomMap.get(socket.id);

    if (existingCode && rooms[existingCode]) {
      socket.emit("errorMessage", "You are already inside a room.");
      sendRoomState(existingCode);
      return;
    }

    const safeMode = mode === "6p" ? "6p" : "4p";

    const room = createBaseRoom({
      hostSocketId: socket.id,
      hostName: cleanName(name),
      mode: safeMode,
      isBotGame: true,
    });

    const playerCount = playerCountFromMode(safeMode);

    for (let i = 1; i < playerCount; i++) {
      room.players.push({
        socketId: null,
        name: `Bot ${i}`,
        index: i,
        connected: true,
        isBot: true,
      });
    }

    socket.join(room.code);
    startGame(room);
    sendRoomState(room.code);
    runBots(room.code);
  });

  socket.on("joinRoom", ({ roomCode, name } = {}) => {
    const code = cleanRoomCode(roomCode);
    const safeName = cleanName(name);

    if (!code) {
      socket.emit("errorMessage", "Please enter a valid room code.");
      return;
    }

    const existingCode = socketRoomMap.get(socket.id);

    if (existingCode && rooms[existingCode]) {
      if (existingCode === code) {
        socket.emit("errorMessage", "You have already joined this room.");
        sendRoomState(code);
        return;
      }

      socket.emit("errorMessage", "You are already inside another room.");
      return;
    }

    const room = rooms[code];

    if (!room) {
      socket.emit("errorMessage", "Room not found.");
      return;
    }

    if (room.isBotGame) {
      socket.emit("errorMessage", "This is a bot room. Other players cannot join.");
      return;
    }

    if (room.status !== "waiting") {
      socket.emit("errorMessage", "Game already started.");
      return;
    }

    const duplicateSocket = room.players.find((p) => p.socketId === socket.id);

    if (duplicateSocket) {
      socket.emit("errorMessage", "You have already joined this room.");
      sendRoomState(code);
      return;
    }

    const duplicateName = room.players.find(
      (p) => p.name.trim().toLowerCase() === safeName.trim().toLowerCase()
    );

    if (duplicateName) {
      socket.emit("errorMessage", "This player name is already used in the room.");
      return;
    }

    if (room.players.length >= room.playerCount) {
      socket.emit("errorMessage", "Room is full.");
      return;
    }

    const index = room.players.length;

    room.players.push({
      socketId: socket.id,
      name: safeName || `Player ${index + 1}`,
      index,
      connected: true,
      isBot: false,
    });

    socketRoomMap.set(socket.id, code);
    socket.join(code);

    room.message = `${safeName || `Player ${index + 1}`} joined.`;

    sendRoomState(code);
  });

  socket.on("startGame", ({ roomCode } = {}) => {
    const code = cleanRoomCode(roomCode);
    const room = rooms[code];

    if (!room) {
      socket.emit("errorMessage", "Room not found.");
      return;
    }

    if (room.hostSocketId !== socket.id) {
      socket.emit("errorMessage", "Only host can start.");
      return;
    }

    startGame(room);
    sendRoomState(code);
    runBots(code);
  });

  socket.on("playCard", ({ roomCode, cardId, selectedTrump } = {}) => {
    const code = cleanRoomCode(roomCode);
    const room = rooms[code];

    if (!room) {
      socket.emit("errorMessage", "Room not found.");
      return;
    }

    const player = room.players.find((p) => p.socketId === socket.id);

    if (!player) {
      socket.emit("errorMessage", "You are not part of this room.");
      return;
    }

    const result = playCardCore(room, player.index, cardId, selectedTrump);

    if (result.needTrump) {
      socket.emit("needTrump", {
        cardId: result.cardId,
      });
      return;
    }

    if (!result.ok) {
      socket.emit("errorMessage", result.error);
      return;
    }

    sendRoomState(code);

    if (result.trickComplete) {
      setTimeout(() => {
        resolveTrick(room);
        sendRoomState(code);
        runBots(code);
      }, 1000);
    } else {
      runBots(code);
    }
  });

  socket.on("nextRound", ({ roomCode } = {}) => {
    const code = cleanRoomCode(roomCode);
    const room = rooms[code];

    if (!room) {
      socket.emit("errorMessage", "Room not found.");
      return;
    }

    if (room.hostSocketId !== socket.id) {
      socket.emit("errorMessage", "Only host can start next round.");
      return;
    }

    room.dealer = (room.dealer + 1) % room.playerCount;
    startGame(room);
    sendRoomState(code);
    runBots(code);
  });

  socket.on("disconnect", () => {
    console.log("Disconnected:", socket.id);

    const code = socketRoomMap.get(socket.id);

    if (!code || !rooms[code]) return;

    const room = rooms[code];
    const player = room.players.find((p) => p.socketId === socket.id);

    if (player) {
      player.connected = false;
      room.message = `${player.name} disconnected.`;
      sendRoomState(code);
    }

    socketRoomMap.delete(socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});