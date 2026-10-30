"use strict";
/* Estado global de la partida y utilidades de solape. */

// ------------------------------------------------------------ Estado del Juego
const cam = { x: 0, y: 0 };
let frame = 0, wave = 0, waveTimer = 0, gameOver = false, paused = false;
let stats = { kills: 0, time: 0, shots: 0 }, goSel = 0, selFrame = -1;

let players = [], enemies = [], bullets = [];
let teleportEffects = [];
const blasts = new Map();

function overlap(ax, ay, a, bx, by, b) {
  return ax + a.x < bx + b.x + b.w && ax + a.x + a.w > bx + b.x &&
         ay + a.y < by + b.y + b.h && ay + a.y + a.h > by + b.y;
}

