let ctx = null;
let muted = false;
const listeners = new Set();

function getCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

export function isMuted() { return muted; }

export function setMuted(val) {
  muted = Boolean(val);
  listeners.forEach((fn) => fn(muted));
}

export function toggleMute() { setMuted(!muted); return muted; }

export function onMuteChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function play(fn) {
  if (muted) return;
  try { fn(getCtx()); } catch (_) { /* audio unavailable */ }
}

function beep(ac, freq, type, vol, start, atk, hold, rel) {
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.connect(g).connect(ac.destination);
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(vol, start + atk);
  g.gain.setValueAtTime(vol, start + atk + hold);
  g.gain.linearRampToValueAtTime(0, start + atk + hold + rel);
  osc.start(start);
  osc.stop(start + atk + hold + rel + 0.01);
}

function noise(ac, vol, start, dur) {
  const buf = ac.createBuffer(1, Math.ceil(ac.sampleRate * dur), ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) * 0.9;
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  const g = ac.createGain();
  g.gain.value = vol;
  src.connect(g).connect(ac.destination);
  src.start(start);
}

export function cardPlay() {
  play((ac) => {
    const t = ac.currentTime;
    beep(ac, 900, "square", 0.1,  t,       0.005, 0,    0.05);
    beep(ac, 280, "sine",   0.07, t + 0.01, 0.005, 0,    0.06);
  });
}

export function deal() {
  play((ac) => {
    noise(ac, 0.35, ac.currentTime, 0.07);
  });
}

export function shuffle() {
  play((ac) => {
    const t = ac.currentTime;
    for (let i = 0; i < 8; i++) {
      noise(ac, 0.22, t + i * 0.1 + Math.random() * 0.03, 0.06);
    }
  });
}

export function trickWin() {
  play((ac) => {
    const t = ac.currentTime;
    [523, 659, 784].forEach((f, i) =>
      beep(ac, f, "sine", 0.14, t + i * 0.09, 0.02, 0.04, 0.2)
    );
  });
}

export function tenCapture() {
  play((ac) => {
    const t = ac.currentTime;
    [880, 1108, 1318, 1760].forEach((f, i) =>
      beep(ac, f, "triangle", 0.16, t + i * 0.05, 0.01, 0.02, 0.32)
    );
  });
}

export function mendikot() {
  play((ac) => {
    const t = ac.currentTime;
    [523, 659, 784, 1047].forEach((f, i) =>
      beep(ac, f, "sawtooth", 0.11, t + i * 0.12, 0.03, 0.07, 0.38)
    );
  });
}

export function bawanya() {
  play((ac) => {
    const t = ac.currentTime;
    [261, 329, 392, 523, 659, 784, 1047].forEach((f, i) =>
      beep(ac, f, "sawtooth", 0.09, t + i * 0.1, 0.03, 0.08, 0.42)
    );
    [523, 659, 784].forEach((f) =>
      beep(ac, f, "sine", 0.12, t + 0.85, 0.06, 0.2, 0.7)
    );
  });
}

export function roundEnd() {
  play((ac) => {
    const t = ac.currentTime;
    [440, 494, 523].forEach((f, i) =>
      beep(ac, f, "sine", 0.11, t + i * 0.15, 0.04, 0.07, 0.42)
    );
  });
}

export function gameWin() {
  play((ac) => {
    const t = ac.currentTime;
    [523, 659, 784, 1047, 784, 1047].forEach((f, i) =>
      beep(ac, f, "triangle", 0.15, t + [0, 0.15, 0.3, 0.45, 0.6, 0.75][i], 0.04, 0.1, 0.32)
    );
  });
}

export function gameLoss() {
  play((ac) => {
    const t = ac.currentTime;
    [440, 392, 349, 294].forEach((f, i) =>
      beep(ac, f, "sine", 0.12, t + i * 0.18, 0.04, 0.1, 0.48)
    );
  });
}
