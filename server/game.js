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

// intensity 1-100: low = weak cut, high = full multi-pass Fisher-Yates
function shuffleDeck(deck, intensity) {
  const d = [...deck];
  const n = d.length;
  const swaps = Math.max(4, Math.round((intensity / 100) * n * 3));
  for (let i = 0; i < swaps; i++) {
    const a = crypto.randomInt(0, n);
    const b = crypto.randomInt(0, n);
    [d[a], d[b]] = [d[b], d[a]];
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
    ...r, trump: pt || r.trump,
    trick: [...r.trick, { playerIndex: pi, card }],
  }) === pi;
}

function lowest(cs)  { return [...cs].sort((a, b) => rank(a) - rank(b))[0]; }
function highest(cs) { return [...cs].sort((a, b) => rank(b) - rank(a))[0]; }

// ─── Card memory helpers ──────────────────────────────────────

// Returns Set of card IDs that have been played in previous tricks
// (computed as: all cards − cards still in hands − cards in current trick)
function getPlayedCardIds(r) {
  const inPlay = new Set();
  for (const hand of r.hands) for (const c of hand) inPlay.add(c.id);
  for (const t of r.trick) inPlay.add(t.card.id);
  const played = new Set();
  for (const s of SUITS) for (const v of VALS) {
    const id = s + v;
    if (!inPlay.has(id)) played.add(id);
  }
  return played;
}

// True if no higher card in the same suit is still in play (unplayed and not in my hand)
function isEstablishedWinner(card, r, pi, played) {
  const mine = new Set((r.hands[pi] || []).map((c) => c.id));
  const inTrick = new Set(r.trick.map((t) => t.card.id));
  for (const v of VALS) {
    if (RANK[v] <= rank(card)) continue;
    const id = card.s + v;
    if (!mine.has(id) && !played.has(id) && !inTrick.has(id)) return false;
  }
  return true;
}

// ─── Bot difficulty ───────────────────────────────────────────

function botNoob(playable) {
  return { card: playable[crypto.randomInt(0, playable.length)] };
}

function botMedium(r, pi, playable) {
  const myTeam = teamOf(pi);
  const hand = r.hands[pi] || [];
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
    return { card: highest(nt.length > 0 ? nt : playable) };
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

function botPro(r, pi, playable) {
  const myTeam   = teamOf(pi);
  const hand     = r.hands[pi] || [];
  const cannotFollow = r.trick.length > 0 && !canFollowLedSuit(r, pi);

  // ── Card memory ──────────────────────────────────────────────
  const played = getPlayedCardIds(r);
  const voids  = r.voids || [];
  const isVoidIn = (idx, suit) => voids[idx] && voids[idx][suit];
  const oppsVoidIn = (suit) =>
    r.players
      .filter((p) => teamOf(p.index) !== myTeam)
      .every((p) => isVoidIn(p.index, suit));

  // ── Situation ────────────────────────────────────────────────
  const myTens   = (r.capturedTens?.[myTeam]       || []).length;
  const oppTens  = (r.capturedTens?.[1 - myTeam]   || []).length;
  const myTricks  = r.tricksWon?.[myTeam]     || 0;
  const oppTricks = r.tricksWon?.[1 - myTeam] || 0;
  const cpp = Math.floor(52 / r.playerCount);          // cards per player = total tricks
  const remainingTricks = cpp - (myTricks + oppTricks);

  const goingForMendikot   = myTens === 3;
  const oppGoingForMendikot = oppTens === 3;
  const bawanyaRisk = myTricks === 0 && oppTricks >= Math.ceil(cpp * 0.35);

  const tensInPlay = playable.filter(isTen);
  const wins       = playable.filter((c) => wouldWin(r, pi, c, r.trump));
  const nonTrumpWins = r.trump ? wins.filter((c) => c.s !== r.trump) : wins;
  const trumpWins    = r.trump ? wins.filter((c) => c.s === r.trump)  : [];

  // Use cheapest win; always prefer non-trump over trump; lowest trump over high trump
  const cheapestWin = () => {
    if (nonTrumpWins.length > 0) return lowest(nonTrumpWins);
    if (trumpWins.length > 0)    return lowest(trumpWins);
    return null;
  };

  // Lowest non-ten, avoiding trump when possible
  const safeDiscard = () => {
    const noTens    = playable.filter((c) => !isTen(c));
    const noTrump   = r.trump ? noTens.filter((c) => c.s !== r.trump) : noTens;
    const src = noTrump.length > 0 ? noTrump : noTens.length > 0 ? noTens : playable;
    return lowest(src);
  };

  // ── Trump declaration forced (no trump yet, can't follow) ────
  if (!r.trump && cannotFollow) {
    const led = r.trick[0].card.s;
    // Pick longest suit (not the led suit) as new trump; play lowest from it
    const bySuit = SUITS
      .filter((s) => s !== led)
      .map((s) => ({ s, cards: hand.filter((c) => c.s === s) }))
      .filter((x) => x.cards.length > 0)
      .sort((a, b) => b.cards.length - a.cards.length);
    if (bySuit.length > 0) {
      const cs = playable.filter((c) => c.s === bySuit[0].s);
      if (cs.length > 0) return { card: lowest(cs) };
    }
    return { card: lowest(playable) };
  }

  if (playable.length === 1) return { card: playable[0] };

  const wp = currentWinnerIndex(r);
  const partnerWinning = wp !== null && teamOf(wp) === myTeam;
  const trickHasTen    = r.trick.some((t) => isTen(t.card));

  // ═══════════════ LEADING ════════════════════════════════════
  if (r.trick.length === 0) {
    // Chase Mendikot: lead our pending ten first
    if (goingForMendikot && tensInPlay.length > 0) return { card: tensInPlay[0] };

    // Counter opponent Mendikot: lead highest trump to pull the outstanding ten
    if (oppGoingForMendikot && r.trump) {
      const myTrumps = playable.filter((c) => c.s === r.trump);
      if (myTrumps.length > 0) return { card: highest(myTrumps) };
    }

    // Bawanya prevention: win at least one trick cheaply
    if (bawanyaRisk) {
      const w = cheapestWin();
      if (w) return { card: w };
    }

    const nt   = r.trump ? playable.filter((c) => c.s !== r.trump) : playable;
    const pool = nt.length > 0 ? nt : playable;

    // Lead a suit all opponents are known void in (they can't follow = safe for us)
    const voidSuitCards = pool.filter(
      (c) => c.s !== r.trump && oppsVoidIn(c.s)
    );
    if (voidSuitCards.length > 0) return { card: highest(voidSuitCards) };

    // Lead established winners — cards that are highest remaining in their suit
    const winners = pool.filter((c) => isEstablishedWinner(c, r, pi, played));
    if (winners.length > 0) return { card: highest(winners) };

    // Fallback: lead highest non-trump
    return { card: highest(pool) };
  }

  // ═══════════════ FOLLOWING ══════════════════════════════════

  // Partner is winning — ride it
  if (partnerWinning) {
    // Unload a ten so partner collects it
    if (tensInPlay.length > 0) return { card: tensInPlay[0] };
    return { card: safeDiscard() };
  }

  // Opponent is winning — decide whether to fight
  const mustFight = trickHasTen || oppGoingForMendikot || bawanyaRisk || goingForMendikot;

  if (mustFight) {
    const w = cheapestWin();
    if (w) return { card: w };
    // Can't win — protect our valuables
    return { card: safeDiscard() };
  }

  // Ordinary trick, opponent winning — win cheaply or let it go
  if (wins.length > 0) {
    const w = cheapestWin();
    if (w) {
      // Don't burn a Queen/King/Ace of trump on a trivial trick when game is young
      if (r.trump && w.s === r.trump && rank(w) >= RANK["Q"] && remainingTricks > 4) {
        return { card: safeDiscard() };
      }
      return { card: w };
    }
  }

  return { card: safeDiscard() };
}

function chooseBotMove(r, pi) {
  const difficulty = (r.players[pi] && r.players[pi].difficulty) || "pro";
  const playable = getPlayable(r, pi);
  if (difficulty === "noob")   return botNoob(playable);
  if (difficulty === "medium") return botMedium(r, pi, playable);
  return botPro(r, pi, playable);
}

// ─── Core card play ───────────────────────────────────────────

function playCardCore(r, pi, cardId) {
  if (!r || r.status !== "playing") return { ok: false, error: "Game is not active." };
  if (!cardId) return { ok: false, error: "Invalid card selected." };
  if (r.trick.some((t) => t.playerIndex === pi)) return { ok: false, error: "Already played." };
  if (r.currentPlayer !== pi) return { ok: false, error: "Not your turn." };
  const hand = r.hands[pi] || [];
  const card = hand.find((c) => c.id === cardId);
  if (!card) return { ok: false, error: "Card not found." };
  const playable = getPlayable(r, pi);
  if (!playable.some((c) => c.id === cardId)) return { ok: false, error: "Must follow suit." };

  const cannotFollow = r.trick.length > 0 && !canFollowLedSuit(r, pi);
  let trumpJustSet = null;
  if (!r.trump && cannotFollow) {
    r.trump = card.s;
    trumpJustSet = card.s;
    r.message = r.players[pi].name + " declared trump: " + SYM[card.s];
  }

  r.hands[pi] = sortHand(hand.filter((c) => c.id !== cardId));
  // Track void: if player doesn't follow the led suit, record they're void in it
  if (r.trick.length > 0) {
    const ledSuit = r.trick[0].card.s;
    if (card.s !== ledSuit) {
      if (!r.voids) r.voids = Array.from({ length: r.playerCount }, () => ({}));
      r.voids[pi][ledSuit] = true;
    }
  }
  r.trick.push({ playerIndex: pi, playerName: r.players[pi].name, card });

  if (r.trick.length === r.playerCount) return { ok: true, trickComplete: true, trumpJustSet };
  r.currentPlayer = (r.currentPlayer + 1) % r.playerCount;
  if (!trumpJustSet) r.message = r.players[r.currentPlayer].name + "'s turn.";
  return { ok: true, trumpJustSet };
}

// ─── Start game ───────────────────────────────────────────────

function startGame(r, intensity) {
  if (!r) return;
  if (r.players.length !== r.playerCount) {
    r.message = "Need " + r.playerCount + " players to start."; return;
  }
  if (r.players.some((p) => !p.connected && !p.isBot)) {
    r.message = "All players must be connected."; return;
  }
  // Reset match-level stats on new game
  if (r.winningTeam !== null) {
    r.scores = [0, 0]; r.winningTeam = null;
    r.mendikotCount = [0, 0]; r.bawanyaCount = [0, 0]; r.normalWins = [0, 0];
  }
  if (!r.mendikotCount)  r.mendikotCount = [0, 0];
  if (!r.bawanyaCount)   r.bawanyaCount  = [0, 0];
  if (!r.normalWins)     r.normalWins    = [0, 0];

  r.status = "playing";
  r.trump  = null;
  r.trick  = [];
  r.tricksWon  = [0, 0];
  r.tensWon    = [0, 0];
  r.capturedTens   = [[], []];
  r.voids = Array.from({ length: r.playerCount }, () => ({}));
  r.lastRoundResult = null;

  const eff = (intensity != null) ? Math.max(1, Math.min(100, intensity)) : 85;
  const deck = shuffleDeck(makeDeck(), eff);
  const cpp  = Math.floor(deck.length / r.playerCount);
  r.hands    = Array.from({ length: r.playerCount }, (_, i) =>
    sortHand(deck.slice(i * cpp, i * cpp + cpp))
  );
  const lead = (r.dealer + 1) % r.playerCount;
  r.leader = lead;
  r.currentPlayer = lead;
  r.roundFirstLeader = lead;
  r.message = r.players[lead].name + " starts. Trump is hidden.";
}

// ─── End round ────────────────────────────────────────────────

function computeNextDealer(r, winner, mendikot, bawanya) {
  const losingTeam   = 1 - winner;
  const dealerTeam   = r.dealer % 2;
  const n            = r.playerCount;

  if (dealerTeam === losingTeam) {
    // Dealer is already on the losing team
    if (mendikot || bawanya) {
      // Shame passes to next player on same team
      return (r.dealer + 2) % n;
    }
    return r.dealer; // Normal loss: same shuffler
  } else {
    // Dealer's team won — hand shuffling to the losing team
    // The losing-team player who led the previous round becomes new shuffler
    const prevLeader = r.roundFirstLeader != null
      ? r.roundFirstLeader
      : (r.dealer + 1) % n;
    // prevLeader is always on the opposite team from dealer
    // so prevLeader % 2 === losingTeam already
    return prevLeader;
  }
}

function endRound(r) {
  const t0 = r.tensWon[0],  t1 = r.tensWon[1];
  const tr0 = r.tricksWon[0], tr1 = r.tricksWon[1];
  const total = tr0 + tr1;

  let winner = null, mendikot = false, bawanya = false;

  if (tr0 === total && total > 0) { winner = 0; bawanya = true; }
  else if (tr1 === total && total > 0) { winner = 1; bawanya = true; }
  else if (t0 === 4) { winner = 0; mendikot = true; }
  else if (t1 === 4) { winner = 1; mendikot = true; }
  else if (t0 > t1)  winner = 0;
  else if (t1 > t0)  winner = 1;
  else winner = tr0 >= tr1 ? 0 : 1;

  const pts = bawanya ? 10 : mendikot ? 5 : 1;
  r.scores[winner] += pts;
  if (bawanya)       r.bawanyaCount[winner]   += 1;
  else if (mendikot) r.mendikotCount[winner]  += 1;
  else               r.normalWins[winner]     += 1;

  const tl = "Team " + (winner + 1);
  if (bawanya)       r.message = tl + " got Bawanya! All tricks! +" + pts + " pts.";
  else if (mendikot) r.message = tl + " got Mendikot! All four tens! +" + pts + " pts.";
  else               r.message = tl + " won (" + (winner === 0 ? t0 : t1) + "/4 tens). +1 pt.";

  const gameOver = r.scores[winner] >= r.targetScore;
  if (gameOver) {
    r.status = "gameOver";
    r.winningTeam = winner;
    r.message = tl + " won the match " + r.scores[winner] + "-" + r.scores[1 - winner] + "!";
  } else {
    r.status = "roundOver";
  }

  const nextDealer = computeNextDealer(r, winner, mendikot, bawanya);

  r.lastRoundResult = {
    id: Date.now(), winner, mendikot, bawanya, points: pts,
    tens: [t0, t1], tricks: [tr0, tr1],
    capturedTens: [r.capturedTens[0].slice(), r.capturedTens[1].slice()],
    scores: [...r.scores],
    mendikotCount: [...r.mendikotCount],
    bawanyaCount:  [...r.bawanyaCount],
    normalWins:    [...r.normalWins],
    nextDealer, gameOver,
  };
}

// ─── Resolve trick ────────────────────────────────────────────

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
  makeDeck, shuffleDeck, sortHand, rank, isTen,
  getPlayable, canFollowLedSuit, beats, trickWinner,
  currentWinnerIndex, wouldWin, lowest, highest,
  chooseBotMove, playCardCore,
  startGame, endRound, resolveTrick,
};
