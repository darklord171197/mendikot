const crypto = require("crypto");

const SUITS = ["s", "h", "d", "c"];
const SYM = { s: "S", h: "H", d: "D", c: "C" };
const VALS = ["3","4","5","6","7","8","9","10","J","Q","K","A"];
const RANK = { 3:3,4:4,5:5,6:6,7:7,8:8,9:9,10:10,J:11,Q:12,K:13,A:14 };

function playerCountFromMode(m) { return m === "6p" ? 6 : 4; }
function teamOf(i) { return i % 2; }

function makeDeck() {
  const d = [];
  for (const s of SUITS) for (const v of VALS) d.push({ s, v, id: s + v });
  return d;
}

function shuffle(d) {
  for (let i = d.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

function sortHand(h) {
  const so = { s: 1, h: 2, d: 3, c: 4 };
  return [...h].sort((a, b) =>
    so[a.s] !== so[b.s] ? so[a.s] - so[b.s] : RANK[a.v] - RANK[b.v]
  );
}

function rank(c) { return RANK[c.v]; }
function isTen(c) { return c.v === "10"; }

function getPlayable(r, pi) {
  const h = r.hands[pi] || [];
  if (r.trick.length === 0) return h;
  const led = r.trick[0].card.s;
  const fs = h.filter((c) => c.s === led);
  return fs.length > 0 ? fs : h;
}

function canFollowLedSuit(r, pi) {
  if (r.trick.length === 0) return true;
  const led = r.trick[0].card.s;
  return (r.hands[pi] || []).some((c) => c.s === led);
}

function beats(r, a, b) {
  const led = r.trick[0].card.s;
  if (r.trump) {
    const aT = a.s === r.trump, bT = b.s === r.trump;
    if (aT && !bT) return true;
    if (!aT && bT) return false;
  }
  if (a.s === b.s) return rank(a) > rank(b);
  if (a.s === led && b.s !== led) return true;
  return false;
}

function trickWinner(r) {
  let best = r.trick[0];
  for (let i = 1; i < r.trick.length; i++) {
    if (beats(r, r.trick[i].card, best.card)) best = r.trick[i];
  }
  return best.playerIndex;
}

function currentWinnerIndex(r) {
  if (r.trick.length === 0) return null;
  return trickWinner(r);
}

function wouldWin(r, pi, card, pt) {
  return trickWinner({
    ...r,
    trump: pt || r.trump,
    trick: [...r.trick, { playerIndex: pi, card }],
  }) === pi;
}

function lowest(cs) { return [...cs].sort((a, b) => rank(a) - rank(b))[0]; }
function highest(cs) { return [...cs].sort((a, b) => rank(b) - rank(a))[0]; }

function chooseBotMove(r, pi) {
  const playable = getPlayable(r, pi);
  const hand = r.hands[pi] || [];
  const myTeam = teamOf(pi);
  const cannotFollow = r.trick.length > 0 && !canFollowLedSuit(r, pi);

  if (!r.trump && cannotFollow) {
    const led = r.trick[0].card.s;
    const counts = { s: 0, h: 0, d: 0, c: 0 };
    for (const c of hand) counts[c.s]++;
    const best = Object.keys(counts)
      .filter((s) => s !== led && counts[s] > 0)
      .sort((a, b) => counts[b] - counts[a])[0];
    if (best) {
      const cs = playable.filter((c) => c.s === best);
      if (cs.length > 0) return { card: lowest(cs) };
    }
    return { card: lowest(playable) };
  }

  if (playable.length === 1) return { card: playable[0] };

  if (r.trick.length === 0) {
    const nt = r.trump ? playable.filter((c) => c.s !== r.trump) : playable;
    if (nt.length > 0) return { card: highest(nt) };
    return { card: lowest(playable) };
  }

  const wp = currentWinnerIndex(r);
  const partnerWinning = wp !== null && teamOf(wp) === myTeam;
  if (partnerWinning) {
    const tens = playable.filter(isTen);
    if (tens.length > 0) return { card: tens[0] };
    return { card: lowest(playable) };
  }

  const wins = playable.filter((c) => wouldWin(r, pi, c, r.trump));
  if (wins.length > 0) return { card: lowest(wins) };

  const nt = r.trump ? playable.filter((c) => c.s !== r.trump) : playable;
  return { card: lowest(nt.length > 0 ? nt : playable) };
}

function playCardCore(r, pi, cardId) {
  if (!r || r.status !== "playing") return { ok: false, error: "Game is not active." };
  if (!cardId) return { ok: false, error: "Invalid card selected." };
  if (r.trick.some((t) => t.playerIndex === pi)) return { ok: false, error: "You have already played in this trick." };
  if (r.currentPlayer !== pi) return { ok: false, error: "It is not your turn." };
  const hand = r.hands[pi] || [];
  const card = hand.find((c) => c.id === cardId);
  if (!card) return { ok: false, error: "Card not found." };
  const playable = getPlayable(r, pi);
  if (!playable.some((c) => c.id === cardId)) return { ok: false, error: "You must follow suit." };

  const cannotFollow = r.trick.length > 0 && !canFollowLedSuit(r, pi);
  let trumpJustSet = null;
  if (!r.trump && cannotFollow) {
    r.trump = card.s;
    trumpJustSet = card.s;
    r.message = r.players[pi].name + " declared trump: " + SYM[card.s];
  }

  r.hands[pi] = sortHand(hand.filter((c) => c.id !== cardId));
  r.trick.push({ playerIndex: pi, playerName: r.players[pi].name, card });

  if (r.trick.length === r.playerCount) {
    return { ok: true, trickComplete: true, trumpJustSet };
  }
  r.currentPlayer = (r.currentPlayer + 1) % r.playerCount;
  if (!trumpJustSet) {
    r.message = r.players[r.currentPlayer].name + "'s turn.";
  }
  return { ok: true, trumpJustSet };
}

function startGame(r) {
  if (!r) return;
  if (r.players.length !== r.playerCount) {
    r.message = "Need " + r.playerCount + " players to start.";
    return;
  }
  if (r.players.some((p) => !p.connected && !p.isBot)) {
    r.message = "All real players must be connected before starting.";
    return;
  }
  // Reset match-level stats on new game
  if (r.winningTeam !== null) {
    r.scores = [0, 0];
    r.winningTeam = null;
    r.mendikotCount = [0, 0];
    r.bawanyaCount = [0, 0];
    r.normalWins = [0, 0];
  }
  // Ensure cumulative stats exist
  if (!r.mendikotCount) r.mendikotCount = [0, 0];
  if (!r.bawanyaCount) r.bawanyaCount = [0, 0];
  if (!r.normalWins) r.normalWins = [0, 0];

  r.status = "playing";
  r.trump = null;
  r.trick = [];
  r.tricksWon = [0, 0];
  r.tensWon = [0, 0];
  r.capturedTens = [[], []];
  r.lastRoundResult = null;
  const deck = shuffle(makeDeck());
  const cpp = Math.floor(deck.length / r.playerCount);
  r.hands = Array.from({ length: r.playerCount }, (_, i) =>
    sortHand(deck.slice(i * cpp, i * cpp + cpp))
  );
  const lead = (r.dealer + 1) % r.playerCount;
  r.leader = lead;
  r.currentPlayer = lead;
  r.message = r.players[lead].name + " starts. Trump is hidden.";
}

function endRound(r) {
  const t0 = r.tensWon[0], t1 = r.tensWon[1];
  const tr0 = r.tricksWon[0], tr1 = r.tricksWon[1];
  const totalTricks = tr0 + tr1;

  let winner = null, mendikot = false, bawanya = false;

  // Bawanya: one team wins ALL tricks
  if (tr0 === totalTricks && totalTricks > 0) { winner = 0; bawanya = true; }
  else if (tr1 === totalTricks && totalTricks > 0) { winner = 1; bawanya = true; }
  // Mendikot: one team captures all 4 tens
  else if (t0 === 4) { winner = 0; mendikot = true; }
  else if (t1 === 4) { winner = 1; mendikot = true; }
  // Normal: most tens, tiebreak by tricks
  else if (t0 > t1) winner = 0;
  else if (t1 > t0) winner = 1;
  else winner = tr0 >= tr1 ? 0 : 1;

  const pts = bawanya ? 10 : mendikot ? 5 : 1;
  r.scores[winner] += pts;

  // Track cumulative stats
  if (bawanya) r.bawanyaCount[winner] += 1;
  else if (mendikot) r.mendikotCount[winner] += 1;
  else r.normalWins[winner] += 1;

  const tl = "Team " + (winner + 1);
  if (bawanya) {
    r.message = tl + " got Bawanya! All tricks! +" + pts + " points.";
  } else if (mendikot) {
    r.message = tl + " got Mendikot! All four tens! +" + pts + " points.";
  } else {
    r.message = tl + " won (" + (winner === 0 ? t0 : t1) + " of 4 tens). +1 point.";
  }

  const gameOver = r.scores[winner] >= r.targetScore;
  if (gameOver) {
    r.status = "gameOver";
    r.winningTeam = winner;
    r.message = tl + " won the match " + r.scores[winner] + "-" + r.scores[1 - winner] + "!";
  } else {
    r.status = "roundOver";
  }

  r.lastRoundResult = {
    id: Date.now(),
    winner, mendikot, bawanya, points: pts,
    tens: [t0, t1], tricks: [tr0, tr1],
    capturedTens: [r.capturedTens[0].slice(), r.capturedTens[1].slice()],
    scores: [...r.scores],
    mendikotCount: [...r.mendikotCount],
    bawanyaCount: [...r.bawanyaCount],
    normalWins: [...r.normalWins],
    gameOver,
  };
}

function resolveTrick(r) {
  if (!r || r.trick.length === 0) return;
  const wi = trickWinner(r);
  const team = teamOf(wi);
  r.tricksWon[team] += 1;
  if (!r.capturedTens) r.capturedTens = [[], []];
  for (const it of r.trick) {
    if (isTen(it.card)) {
      r.tensWon[team] += 1;
      r.capturedTens[team].push(it.card);
    }
  }
  r.trick = [];
  r.currentPlayer = wi;
  r.leader = wi;
  r.message = r.players[wi].name + " won the trick.";
  if (r.hands.every((h) => h.length === 0)) endRound(r);
}

module.exports = {
  SUITS, SYM, VALS, RANK,
  playerCountFromMode, teamOf,
  makeDeck, shuffle, sortHand, rank, isTen,
  getPlayable, canFollowLedSuit, beats, trickWinner,
  currentWinnerIndex, wouldWin, lowest, highest,
  chooseBotMove, playCardCore,
  startGame, endRound, resolveTrick,
};
