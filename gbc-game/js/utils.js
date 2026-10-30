"use strict";
/* Hitboxes, direcciones, aritmetica entera, RNG y dimensiones del mapa. */

const DIAG = 181; // 256 * 0.7071

// Hitboxes
const PBOX = { x: 4, y: 10, w: 8, h: 6 };
const EBOX = { x: 1, y: 1, w: 6, h: 6 };
const BBOX = { x: 0, y: 0, w: 1, h: 1 };

const DIRS = [[-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1]];
const DIR_INDEX = [];
// Pixel claro de la punta del bazooka dentro del sprite 16x16, por direccion: [filas 0/2/4, filas 1/3].
const BAZOOKA_TIP = [
  [[1, 8], [1, 7]], [[3, 3], [2, 3]], [[6, 2], [6, 1]], [[11, 1], [11, 2]],
  [[9, 2], [9, 1]], [[12, 3], [13, 3]], [[14, 8], [14, 7]], [[4, 11], [4, 10]],
];
DIRS.forEach((d, i) => { DIR_INDEX[(d[1] + 1) * 3 + (d[0] + 1)] = i; });

// ------------------------------------------------------------ Aritmetica entera (sin coma flotante)
// Angulos de 0-255 (256 = vuelta completa, 0 = derecha, 64 = abajo). Valores en 8.8 (256 = 1.0).
const mulf = (a, b) => (a * b) >> 8;
const SIN_TAB = new Int16Array(256); // tabla constante (en ROM en la consola)
for (let i = 0; i < 256; i++) SIN_TAB[i] = Math.round(Math.sin(i * Math.PI / 128) * 256);
const sinb = (a) => SIN_TAB[a & 255];
const cosb = (a) => SIN_TAB[(a + 64) & 255];
// Angulo de cada direccion de DIRS y su vector unitario en 8.8
const DIR_ANG = DIRS.map((d, i) => (96 + 32 * i) & 255);
const DIRU = DIR_ANG.map((a) => [cosb(a), sinb(a)]);
// Octante 0-7 (DIRS) mas cercano a un angulo
const dirFromAngle = (a) => (5 + (((a + 16) >> 5) & 7)) & 7;
// atan2 aproximado en angulos de 0-255 (error < 1 unidad)
function atan2b(y, x) {
  if (!x && !y) return 0;
  const ax = x < 0 ? -x : x, ay = y < 0 ? -y : y;
  const lo = ay <= ax ? ay : ax, hi = ay <= ax ? ax : ay;
  const r = ((lo << 8) / hi) | 0; // 0-256
  let a = (32 * r + 11 * ((r * (256 - r)) >> 8)) >> 8; // atan(r) ~ r*(pi/4 + 0.273*(1-r))
  if (ay > ax) a = 64 - a;
  if (x < 0) a = 128 - a;
  if (y < 0) a = (256 - a) & 255;
  return a & 255;
}
// Generador pseudoaleatorio xorshift de 16 bits (determinista, sin Math.random)
let rngState = 0xACE1;
function rand16() {
  rngState ^= (rngState << 7) & 0xFFFF;
  rngState ^= rngState >> 9;
  rngState ^= (rngState << 8) & 0xFFFF;
  return rngState;
}
const rnd = (n) => (rand16() * n) >> 16; // 0..n-1
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) { const j = rnd(i + 1); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}

let MAP_W = 32, MAP_H = 32;
const HUD_H = 16;
const VIEW_H = 144 - HUD_H;
let assets;

