"use strict";
/* Sonido chiptune (WebAudio). */

// ------------------------------------------------------------ Sonido chiptune (WebAudio, ondas cuadradas y ruido)
let audioCtx = null, noiseBuf = null;
function initAudio() {
  if (audioCtx) { if (audioCtx.state === "suspended") audioCtx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  audioCtx = new AC();
  noiseBuf = audioCtx.createBuffer(1, audioCtx.sampleRate, audioCtx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}
window.addEventListener("keydown", initAudio);
window.addEventListener("pointerdown", initAudio);
window.addEventListener("gamepadconnected", initAudio);

// Tono: barrido de frecuencia f0->f1 durante dur segundos. duty: 0.125/0.25/0.5 aprox. con onda cuadrada.
function tone(f0, f1, dur, vol, type, delay) {
  if (!audioCtx || audioCtx.state !== "running" || !CFG.volume || !settings.master || !settings.sfx) return;
  const t = audioCtx.currentTime + (delay || 0);
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(vol * CFG.volume * (settings.master / 5) * (settings.sfx / 5), t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.connect(audioCtx.destination);
  let src;
  if (type === "noise") {
    src = audioCtx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    src.playbackRate.setValueAtTime(f0, t);
    src.playbackRate.linearRampToValueAtTime(f1, t + dur);
  } else {
    src = audioCtx.createOscillator();
    src.type = "square";
    src.frequency.setValueAtTime(f0, t);
    src.frequency.exponentialRampToValueAtTime(f1, t + dur);
  }
  src.connect(g);
  src.start(t);
  src.stop(t + dur + 0.02);
}

const SFX = {
  shot: () => { tone(900, 200, 0.12, 0.25, "square"); tone(3, 1, 0.08, 0.15, "noise"); },
  explosion: () => tone(1.2, 0.2, 0.25, 0.35, "noise"),
  hit: () => tone(300, 150, 0.06, 0.2, "square"),
  enemyDie: () => { tone(600, 100, 0.2, 0.25, "square"); tone(2, 0.5, 0.15, 0.15, "noise"); },
  hurt: () => { tone(400, 80, 0.3, 0.3, "square"); tone(1.5, 0.3, 0.2, 0.2, "noise"); },
  coin: () => { tone(988, 988, 0.07, 0.2, "square"); tone(1319, 1319, 0.15, 0.2, "square", 0.07); },
  heart: () => { tone(523, 523, 0.08, 0.2, "square"); tone(659, 659, 0.08, 0.2, "square", 0.08); tone(784, 784, 0.15, 0.2, "square", 0.16); },
  teleport: () => tone(200, 1600, 0.18, 0.2, "square"),
  reload: () => { tone(300, 300, 0.05, 0.2, "square"); tone(500, 500, 0.08, 0.2, "square", 0.1); },
  empty: () => tone(150, 150, 0.06, 0.2, "square"),
  special: () => { tone(120, 900, 0.5, 0.3, "square"); tone(1, 3, 0.5, 0.2, "noise"); },
  open: () => { tone(440, 880, 0.12, 0.2, "square"); tone(880, 1760, 0.2, 0.2, "square", 0.12); },
};
function sfx(name) { try { SFX[name](); } catch (err) { /* sin audio */ } }

