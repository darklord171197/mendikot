const STORAGE_KEY = "playerStats";

const DEFAULT_STATS = {
  gamesPlayed: 0,
  wins: 0,
  losses: 0,
  mendikots: 0,
  bawanyas: 0,
};

export function getStats() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return { ...DEFAULT_STATS, ...raw };
  } catch {
    return { ...DEFAULT_STATS };
  }
}

function saveStats(stats) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
}

export const BADGES = [
  { id: "mendikot-1",  category: "mendikots",   threshold: 1,   label: "First Mendikot",  icon: "🃏" },
  { id: "mendikot-5",  category: "mendikots",   threshold: 5,   label: "Mendikot x5",      icon: "🃏" },
  { id: "mendikot-10", category: "mendikots",   threshold: 10,  label: "Mendikot x10",     icon: "🃏" },
  { id: "bawanya-1",   category: "bawanyas",    threshold: 1,   label: "First Bawanya",    icon: "💥" },
  { id: "bawanya-5",   category: "bawanyas",    threshold: 5,   label: "Bawanya x5",       icon: "💥" },
  { id: "bawanya-10",  category: "bawanyas",    threshold: 10,  label: "Bawanya x10",      icon: "💥" },
  { id: "games-1",     category: "gamesPlayed", threshold: 1,   label: "First Game",       icon: "🎮" },
  { id: "games-10",    category: "gamesPlayed", threshold: 10,  label: "10 Games Played",  icon: "🎮" },
  { id: "games-100",   category: "gamesPlayed", threshold: 100, label: "100 Games Played", icon: "🎮" },
];

export function getUnlockedBadgeIds(stats) {
  return BADGES.filter((b) => (stats[b.category] || 0) >= b.threshold).map((b) => b.id);
}

function diffNewBadges(before, after) {
  const beforeIds = new Set(getUnlockedBadgeIds(before));
  return getUnlockedBadgeIds(after)
    .filter((id) => !beforeIds.has(id))
    .map((id) => BADGES.find((b) => b.id === id));
}

export function recordRoundResult({ mendikot, bawanya, won }) {
  const before = getStats();
  const stats = { ...before };
  if (won && mendikot) stats.mendikots += 1;
  if (won && bawanya) stats.bawanyas += 1;
  saveStats(stats);
  return { stats, newlyUnlocked: diffNewBadges(before, stats) };
}

export function recordGameResult({ won }) {
  const before = getStats();
  const stats = { ...before };
  stats.gamesPlayed += 1;
  if (won) stats.wins += 1;
  else stats.losses += 1;
  saveStats(stats);
  return { stats, newlyUnlocked: diffNewBadges(before, stats) };
}
