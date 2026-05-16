const express = require("express");
const http = require("http");
const crypto = require("crypto");
const cors = require("cors");
const { Server } = require("socket.io");

// ============================================================
// CORS / config
// ============================================================

const ALLOWED_ORIGINS = [
  /^http:\/\/localhost:\d+$/,
  /^http:\/\/127\.0\.0\.1:\d+$/,
  /^https:\/\/mendikot(-[a-z0-9-]+)?\.vercel\.app$/,
];

function isOriginAllowed(origin) {
  if (!origin) return true; // same-origin or curl
  return ALLOWED_ORIGINS.some((re) => re.test(origin));
}

const corsOptions = {
  origin: (origin, cb) => {
    if (isOriginAllowed(origin)) return cb(null, true);
    return cb(new Error("Origin not allowed by CORS"));
  },
  methods: ["GET", "POST"],
};

const app = express();
app.use(cors(corsOptions));

const server = http.createServer(app);
const io = new Server(server, { cors: corsOptions });

const PORT = process.env.PORT || 5000;
const TARGET_SCORE = Number(process.env.TARGET_SCORE) || 7;
const ROOM_TTL_MS = 1000 * 60 * 60 * 2; // 2h of inactivity
const ROOM_SWEEP_MS = 1000 * 60 * 5; // sweep every 5 min
const RATE_LIMIT_WINDOW_MS = 1000;
const RATE_LIMIT_MAX = 25;

// ============================================================
// Game constants
// ============================================================

const SUITS = ["s", "h", "d", "c"];
const SYM = { s: "♠", h: "♥", d: "♦", c: "♣" };
const VALS = ["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];

const RANK = {
  3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10,
  J: 11, Q: 12, K: 13, A: 14,
};

// ============================================================
// State
// ============================================================

const rooms = {};
const socketRoomMap = new Map();
const rateLimitMap = new Map();

// ============================================================
// Helpers
// ============================================================

function rateLimit(socketId) {
  const now = Date.now();
  const entry = rateLimitMap.get(socketId);
  if (!entry || now - entry.start > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(socketId, { start: now, count: 1 });
    return true;
  }
  entry.count += 1;
  return entry.count <= RATE_LIMIT_MAX;
}

function makeToken() {
  return crypto.randomBytes(16).toString("hex");
}

function cleanName(name) {
  const value = String(name || "").trim();
  // strip ASCII control chars and common zero-width / formatting chars
  const safe = value.replace(
    /[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\uFEFF]/g,
    ""
  );
  return safe.length ? safe.slice(0, 20) : "Player";
}

function cleanRoomCode(roomCode) {
  const v = String(roomCode || "").trim().toUpperCase();
  return /^[A-Z0-9]{5}$/.test(v) ? v : "";
}

function createRoomCode() {
  let code;
  do {
    const buf = crypto
      .randomBytes(8)
      .toString("base64")
      .replace(/[^A-Z0-9]/gi, "")
      .toUpperCase();
    code = buf.slice(0, 5);
    if (code.length < 5) {
      code = Math.random()
        .toString(36)
        .substring(2, 7)
        .toUpperCase()
        .padEnd(5, "X");
    }
  } while (rooms[code]);
  return code;
}

function touchRoom(room) {
  if (room) room.lastActivity = Date.now();
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
      deck.push({ s, v, id: `${s}${v}` });
    }
  }
  return deck;
}

function shuffle(deck) {
  // Fisher–Yates with crypto randomness
  for (let i = deck.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function sortHand(hand) {
  const suitOrder = { s: 1, h: 2, d: 3, c: 4 };
  return [...hand].sort((a, b) => {
    if (suitOrder[a.s] !== suitOrder[b.s]) return suitOrder[a.s] - suitOrder[b.s];
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

  if (a.s === b.s) return rank(a) > rank(b);
  if (a.s === ledSuit && b.s !== ledSuit) return true;

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

// ============================================================
// Room lifecycle
// ============================================================

function clearRoomTimers(room) {
  if (!room) return;
  if (room.botTimer) clearTimeout(room.botTimer);
  if (room.trickTimer) clearTimeout(room.trickTimer);
  room.botTimer = null;
  room.trickTimer = null;
}

function deleteRoom(code) {
  const room = rooms[code];
  if (!room) return;
  clearRoomTimers(room);
  for (const p of room.players) {
    if (p.socketId) socketRoomMap.delete(p.socketId);
  }
  delete rooms[code];
}

function createBaseRoom({ hostSocketId, hostName, mode = "4p", isBotGame = false }) {
  const code = createRoomCode();

  const safeMode = mode === "6p" ? "6p" : "4p";

  const room = {
    code,
    mode: safeMode,
    playerCount: playerCountFromMode(safeMode),
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

    targetScore: TARGET_SCORE,
    winningTeam: null,

    message: "Waiting for players...",
    botTimer: null,
    trickTimer: null,
    lastActivity: Date.now(),
  };

  const hostToken = makeToken();
  room.players.push({
    socketId: hostSocketId,
    name: cleanName(hostName),
    token: hostToken,
    index: 0,
    connected: true,
    isBot: false,
  });

  rooms[code] = room;
  socketRoomMap.set(hostSocketId, code);

  return { room, hostToken };
}

// ============================================================
// Public state shaping
// ============================================================

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
    playableCardIds:
      room.status === "playing" && room.currentPlayer === myIndex
        ? getPlayable(room, myIndex).map((c) => c.id)
        : [],

    handCounts: room.hands.map((h) => h.length),

    trick: room.trick,
    currentPlayer: room.currentPlayer,
    leader: room.leader,
    dealer: room.dealer,
    trump: room.trump,

    scores: room.scores,
    tricksWon: room.tricksWon,
    tensWon: room.tensWon,
    targetScore: room.targetScore,
    winningTeam: room.winningTeam,

    message: room.message,
    isHost: socketId === room.hostSocketId,
  };
}

function sendRoomState(roomCode) {
  const code = cleanRoomCode(roomCode);
  if (!code) return;
  const room = rooms[code];
  if (!room) return;
  touchRoom(room);

  for (const p of room.players) {
    if (!p.isBot && p.socketId) {
      io.to(p.socketId).emit("state", publicState(room, p.socketId));
    }
  }
}

// ============================================================
// Round / game flow
// ============================================================

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

  if (room.winningTeam !== null) {
    // reset for a fresh game
    room.scores = [0, 0];
    room.winningTeam = null;
  }

  room.status = "playing";
  room.trump = null;
  room.trick = [];
  room.tricksWon = [0, 0];
  room.tensWon = [0, 0];

  const deck = shuffle(makeDeck());
  const cardsPerPlayer = Math.floor(deck.length / room.playerCount);

  room.hands = Array.from({ length: room.playerCount }, (_, i) => {
    const cards = deck.slice(
      i * cardsPerPlayer,
      i * cardsPerPlayer + cardsPerPlayer
    );
    return sortHand(cards);
  });

  // Player to dealer's left leads first
  const lead = (room.dealer + 1) % room.playerCount;
  room.leader = lead;
  room.currentPlayer = lead;

  room.message = `${room.players[lead].name} starts. Trump is hidden.`;
}

function endRound(room) {
  // Mendikot scoring: capture all four 10s = Mendikot (+2),
  // otherwise team with majority of 10s = +1.
  // If 10s are tied (rare in 6p when only some players hold 10s
  // and they split 2/2), fall back to whoever won more tricks.
  const tens0 = room.tensWon[0];
  const tens1 = room.tensWon[1];
  const tricks0 = room.tricksWon[0];
  const tricks1 = room.tricksWon[1];

  let winner = null;
  let mendikot = false;

  if (tens0 === 4) {
    winner = 0;
    mendikot = true;
  } else if (tens1 === 4) {
    winner = 1;
    mendikot = true;
  } else if (tens0 > tens1) {
    winner = 0;
  } else if (tens1 > tens0) {
    winner = 1;
  } else {
    winner = tricks0 >= tricks1 ? 0 : 1;
  }

  const points = mendikot ? 2 : 1;
  room.scores[winner] += points;

  const teamLabel = `Team ${winner + 1}`;
  room.message = mendikot
    ? `${teamLabel} got Mendikot! +${points} points.`
    : `${teamLabel} won the round (${winner === 0 ? tens0 : tens1} of 4 tens). +${points} point.`;

  if (room.scores[winner] >= room.targetScore) {
    room.status = "gameOver";
    room.winningTeam = winner;
    room.message = `${teamLabel} won the match ${room.scores[winner]}–${room.scores[1 - winner]}!`;
  } else {
    room.status = "roundOver";
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

// ============================================================
// Bot AI
// ============================================================

function currentWinnerIndex(room) {
  if (room.trick.length === 0) return null;
  return trickWinner(room);
}

function wouldWin(room, playerIndex, card, prospectiveTrump) {
  const fakeRoom = {
    ...room,
    trump: prospectiveTrump || room.trump,
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
  const ledSuit = room.trick[0]?.card.s;
  const counts = { s: 0, h: 0, d: 0, c: 0 };
  for (const c of hand) counts[c.s]++;
  // Prefer your longest suit, but never declare the led suit (you can't follow it anyway).
  return Object.keys(counts)
    .filter((s) => s !== ledSuit)
    .sort((a, b) => counts[b] - counts[a])[0];
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

  // The trump that will be in effect for THIS card.
  const effectiveTrump = room.trump || selectedTrump;

  if (playable.length === 1) {
    return { card: playable[0], selectedTrump };
  }

  if (room.trick.length === 0) {
    const nonTrump = effectiveTrump
      ? playable.filter((c) => c.s !== effectiveTrump)
      : playable;

    if (nonTrump.length > 0) {
      return { card: highest(nonTrump), selectedTrump };
    }
    return { card: lowest(playable), selectedTrump };
  }

  const winningPlayer = currentWinnerIndex(room);
  const partnerWinning =
    winningPlayer !== null && teamOf(winningPlayer) === myTeam;

  if (partnerWinning) {
    // Drop a 10 if partner is winning (give it to your team)
    const tens = playable.filter(isTen);
    if (tens.length > 0) {
      return { card: tens[0], selectedTrump };
    }
    return { card: lowest(playable), selectedTrump };
  }

  const winningCards = playable.filter((c) =>
    wouldWin(room, playerIndex, c, effectiveTrump)
  );

  if (winningCards.length > 0) {
    // win as cheaply as possible
    return { card: lowest(winningCards), selectedTrump };
  }

  const nonTrump = effectiveTrump
    ? playable.filter((c) => c.s !== effectiveTrump)
    : playable;

  return {
    card: lowest(nonTrump.length > 0 ? nonTrump : playable),
    selectedTrump,
  };
}

// ============================================================
// Play core
// ============================================================

function playCardCore(room, playerIndex, cardId, selectedTrump) {
  if (!room || room.status !== "playing") {
    return { ok: false, error: "Game is not active." };
  }

  if (!cardId) {
    return { ok: false, error: "Invalid card selected." };
  }

  if (room.trick.some((t) => t.playerIndex === playerIndex)) {
    return { ok: false, error: "You have already played in this trick." };
  }

  if (room.currentPlayer !== playerIndex) {
    return { ok: false, error: "It is not your turn." };
  }

  const hand = room.hands[playerIndex] || [];
  const card = hand.find((c) => c.id === cardId);

  if (!card) {
    return { ok: false, error: "Card not found." };
  }

  const playable = getPlayable(room, playerIndex);

  if (!playable.some((c) => c.id === cardId)) {
    return { ok: false, error: "You must follow suit." };
  }

  const cannotFollow =
    room.trick.length > 0 && !canFollowLedSuit(room, playerIndex);

  if (!room.trump && cannotFollow) {
    if (!selectedTrump) {
      return { ok: false, needTrump: true, cardId };
    }

    if (!SUITS.includes(selectedTrump)) {
      return { ok: false, error: "Invalid trump." };
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
    return { ok: true, trickComplete: true };
  }

  room.currentPlayer = (room.currentPlayer + 1) % room.playerCount;
  room.message = `${room.players[room.currentPlayer].name}'s turn.`;

  return { ok: true };
}

// ============================================================
// Bot loop
// ============================================================

function runBots(roomCode) {
  const code = cleanRoomCode(roomCode);
  if (!code) return;
  const room = rooms[code];

  if (!room || room.status !== "playing") return;

  const current = room.players[room.currentPlayer];
  if (!current || !current.isBot) return;

  // If this is a bot game and no human is connected, pause the bots so we
  // don't spin forever on an abandoned room.
  if (
    room.isBotGame &&
    !room.players.some((p) => !p.isBot && p.connected)
  ) {
    return;
  }

  if (room.botTimer) clearTimeout(room.botTimer);

  room.botTimer = setTimeout(() => {
    room.botTimer = null;
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
      if (freshRoom.trickTimer) clearTimeout(freshRoom.trickTimer);
      freshRoom.trickTimer = setTimeout(() => {
        freshRoom.trickTimer = null;
        const r = rooms[code];
        if (!r) return;
        resolveTrick(r);
        sendRoomState(code);
        runBots(code);
      }, 1000);
    } else {
      runBots(code);
    }
  }, 800);
}

// ============================================================
// Reconnect / host migration
// ============================================================

function migrateHostIfNeeded(room) {
  if (!room) return;
  const host = room.players.find(
    (p) => p.socketId === room.hostSocketId && p.connected && !p.isBot
  );
  if (host) return;

  const next = room.players.find((p) => !p.isBot && p.connected);
  if (next) {
    room.hostSocketId = next.socketId;
    room.message = `${next.name} is now host.`;
  } else {
    room.hostSocketId = null;
  }
}

function reconnectPlayer(socket, roomCode, name, token) {
  const code = cleanRoomCode(roomCode);
  if (!code) {
    socket.emit("errorMessage", "Invalid room code.");
    return false;
  }

  const safeName = cleanName(name);
  const room = rooms[code];

  if (!room) {
    socket.emit("errorMessage", "Room not found.");
    return false;
  }

  // Token-based match (preferred). Fallback to name match ONLY if the player
  // currently has no token assigned (legacy session).
  let player = null;
  if (token) {
    player = room.players.find((p) => p.token && p.token === token);
  }
  if (!player) {
    const candidate = room.players.find(
      (p) =>
        !p.isBot &&
        p.name.trim().toLowerCase() === safeName.trim().toLowerCase()
    );
    if (candidate && !candidate.token) {
      player = candidate; // legacy upgrade
      player.token = makeToken();
    }
  }

  if (!player) return false;

  // Migrate the previous socket binding away
  if (player.socketId && player.socketId !== socket.id) {
    socketRoomMap.delete(player.socketId);
  }

  player.socketId = socket.id;
  player.connected = true;

  socketRoomMap.set(socket.id, code);
  socket.join(code);

  // If host slot is empty, take it
  if (!room.hostSocketId) {
    room.hostSocketId = socket.id;
  } else if (
    !room.players.some(
      (p) => p.socketId === room.hostSocketId && p.connected && !p.isBot
    )
  ) {
    room.hostSocketId = socket.id;
  }

  room.message = `${player.name} reconnected.`;
  touchRoom(room);

  socket.emit("session", { roomCode: code, token: player.token });
  sendRoomState(code);

  // If bots were paused, resume now
  if (room.isBotGame && room.status === "playing") runBots(code);

  return true;
}

// ============================================================
// Sweep abandoned rooms
// ============================================================

setInterval(() => {
  const now = Date.now();
  for (const code of Object.keys(rooms)) {
    const room = rooms[code];
    if (!room) continue;
    const anyConnected = room.players.some((p) => !p.isBot && p.connected);
    if (!anyConnected && now - (room.lastActivity || 0) > ROOM_TTL_MS) {
      console.log(`Sweeping abandoned room ${code}`);
      deleteRoom(code);
    }
  }
}, ROOM_SWEEP_MS);

// ============================================================
// Socket events
// ============================================================

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  function guard(event, fn) {
    socket.on(event, (...args) => {
      if (!rateLimit(socket.id)) {
        socket.emit("errorMessage", "You're sending events too fast.");
        return;
      }
      try {
        fn(...args);
      } catch (err) {
        console.error(`Handler ${event} threw:`, err);
        socket.emit("errorMessage", "Server error.");
      }
    });
  }

  guard("createRoom", ({ name, mode } = {}) => {
    const existingCode = socketRoomMap.get(socket.id);

    if (existingCode && rooms[existingCode]) {
      socket.emit("errorMessage", "You are already inside a room.");
      sendRoomState(existingCode);
      return;
    }

    const safeMode = mode === "6p" ? "6p" : "4p";

    const { room, hostToken } = createBaseRoom({
      hostSocketId: socket.id,
      hostName: cleanName(name),
      mode: safeMode,
      isBotGame: false,
    });

    socket.join(room.code);
    socket.emit("session", { roomCode: room.code, token: hostToken });
    sendRoomState(room.code);
  });

  guard("createBotGame", ({ name, mode } = {}) => {
    const existingCode = socketRoomMap.get(socket.id);

    if (existingCode && rooms[existingCode]) {
      socket.emit("errorMessage", "You are already inside a room.");
      sendRoomState(existingCode);
      return;
    }

    const safeMode = mode === "6p" ? "6p" : "4p";

    const { room, hostToken } = createBaseRoom({
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
        token: null,
        index: i,
        connected: true,
        isBot: true,
      });
    }

    socket.join(room.code);
    socket.emit("session", { roomCode: room.code, token: hostToken });
    startGame(room);
    sendRoomState(room.code);
    runBots(room.code);
  });

  guard("reconnectPlayer", ({ roomCode, name, token } = {}) => {
    const ok = reconnectPlayer(socket, roomCode, name, token);
    if (!ok) {
      socket.emit("reconnectFailed", "Player not found in this room.");
    }
  });

  guard("joinRoom", ({ roomCode, name } = {}) => {
    const code = cleanRoomCode(roomCode);
    const safeName = cleanName(name);

    if (!code) {
      socket.emit("errorMessage", "Please enter a valid 5-character room code.");
      return;
    }

    const existingCode = socketRoomMap.get(socket.id);

    if (existingCode && rooms[existingCode]) {
      if (existingCode === code) {
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

    // No "join by name" hijacking — only token-based reconnect can claim a
    // seat. A new join with a duplicate name is rejected.
    const nameTaken = room.players.some(
      (p) =>
        !p.isBot &&
        p.name.trim().toLowerCase() === safeName.trim().toLowerCase()
    );

    if (nameTaken) {
      socket.emit(
        "errorMessage",
        "Name already taken in this room. If that's you, refresh — your session token will reconnect you."
      );
      return;
    }

    if (room.status !== "waiting") {
      socket.emit("errorMessage", "Game already started.");
      return;
    }

    if (room.players.length >= room.playerCount) {
      socket.emit("errorMessage", "Room is full.");
      return;
    }

    const index = room.players.length;
    const token = makeToken();

    room.players.push({
      socketId: socket.id,
      name: safeName || `Player ${index + 1}`,
      token,
      index,
      connected: true,
      isBot: false,
    });

    socketRoomMap.set(socket.id, code);
    socket.join(code);

    room.message = `${safeName || `Player ${index + 1}`} joined.`;
    touchRoom(room);

    socket.emit("session", { roomCode: code, token });
    sendRoomState(code);
  });

  guard("startGame", ({ roomCode } = {}) => {
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

  guard("playCard", ({ roomCode, cardId, selectedTrump } = {}) => {
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
      socket.emit("needTrump", { cardId: result.cardId });
      return;
    }

    if (!result.ok) {
      socket.emit("errorMessage", result.error);
      return;
    }

    sendRoomState(code);

    if (result.trickComplete) {
      if (room.trickTimer) clearTimeout(room.trickTimer);
      room.trickTimer = setTimeout(() => {
        room.trickTimer = null;
        const r = rooms[code];
        if (!r) return;
        resolveTrick(r);
        sendRoomState(code);
        runBots(code);
      }, 1000);
    } else {
      runBots(code);
    }
  });

  guard("nextRound", ({ roomCode } = {}) => {
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

    if (room.status === "gameOver") {
      // host can also use this to start a fresh match
      room.scores = [0, 0];
      room.winningTeam = null;
    } else if (room.status !== "roundOver") {
      socket.emit("errorMessage", "Round is not over yet.");
      return;
    }

    room.dealer = (room.dealer + 1) % room.playerCount;
    startGame(room);
    sendRoomState(code);
    runBots(code);
  });

  guard("leaveRoom", () => {
    const code = socketRoomMap.get(socket.id);
    if (!code || !rooms[code]) return;

    const room = rooms[code];
    const player = room.players.find((p) => p.socketId === socket.id);

    if (player) {
      // If game hasn't started, drop the player entirely. Otherwise mark
      // disconnected so they can come back via token.
      if (room.status === "waiting") {
        room.players = room.players
          .filter((p) => p.socketId !== socket.id)
          .map((p, i) => ({ ...p, index: i }));
      } else {
        player.connected = false;
        player.socketId = null;
      }

      room.message = `${player.name} left.`;
      socketRoomMap.delete(socket.id);
      socket.leave(code);

      migrateHostIfNeeded(room);

      const anyConnected = room.players.some((p) => !p.isBot && p.connected);
      if (!anyConnected) {
        clearRoomTimers(room);
        if (room.status === "waiting") {
          // empty waiting room — drop it now
          deleteRoom(code);
          return;
        }
      } else {
        sendRoomState(code);
      }
    }
  });

  socket.on("disconnect", () => {
    console.log("Disconnected:", socket.id);
    rateLimitMap.delete(socket.id);

    const code = socketRoomMap.get(socket.id);
    if (!code || !rooms[code]) return;

    const room = rooms[code];
    const player = room.players.find((p) => p.socketId === socket.id);

    if (player) {
      player.connected = false;
      room.message = `${player.name} disconnected.`;
      migrateHostIfNeeded(room);

      const anyConnected = room.players.some((p) => !p.isBot && p.connected);
      if (!anyConnected) {
        clearRoomTimers(room);
        if (room.status === "waiting") {
          deleteRoom(code);
          socketRoomMap.delete(socket.id);
          return;
        }
      } else {
        sendRoomState(code);
      }
    }

    socketRoomMap.delete(socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
