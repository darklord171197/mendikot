export const AVATAR_OPTIONS = [
  "🧑", "👩", "🧔", "👨‍🦰", "👩‍🦱", "🧑‍🦳",
  "🤴", "👑", "🥷", "🧙", "🦸", "🥳",
  "😎", "🤓", "🐯", "🦁", "🐸", "🐵", "🦊", "🐺",
];

export function getAvatar() {
  const v = localStorage.getItem("playerAvatar");
  return AVATAR_OPTIONS.includes(v) ? v : AVATAR_OPTIONS[0];
}

export function setAvatar(emoji) {
  if (!AVATAR_OPTIONS.includes(emoji)) return;
  localStorage.setItem("playerAvatar", emoji);
}
