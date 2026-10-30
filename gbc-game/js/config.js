"use strict";
/* Configuracion: canvas, parametros de juego (CFG) y ajustes del jugador. */

const canvas = document.getElementById("screen");
const gbc = new GBC(canvas);
const input = new Input();

// ------------------------------------------------------------ Parametros de juego
const CFG = {
  // Velocidades y multiplicadores en 8.8 (256 = 1 px/frame o x1.0)
  playerSpeed: 256,
  enemySpeed: 26,
  chaseRange: 5,
  blastRadius: 12, // pixeles
  fuseRadius: 8,
  blastFrames: 10,
  wanderFactor: 128,
  speedJitter: 26,
  teleportDistance: 2,
  teleportCooldown: 40,
  teleportStepFrames: 4,
  teleportEffectFrames: 32,
  hurtFlash: 6,
  barrierHp: 3,
  bulletSpeed: 3 * 256,
  bulletRange: 88,
  bulletGroundOffset: 8,
  fireDelay: 40, // frames entre disparos
  ammoMax: 25,
  reloadFrames: 240,
  specialCharge: 2400,
  specialFrames: 240,
  specialTickFrames: 30,
  specialDamage: 1,
  volume: 0.5, // solo audio web
  nudgePixels: 3,
  // Objetos del mapa que aparecen al cargar (el resto de ubicaciones se descarta al azar).
  crystalCount: 1,
  chestCount: 4,
  manaBoxCount: 4,
  // Cantidad de enemigos por oleada: waveBase + (oleada-1) * wavePerWave, hasta waveMax.
  waveBase: 30,
  wavePerWave: 10,
  waveMax: 120,
  // Limites de dibujado tipo Game Boy: si se superan, los sobrantes parpadean (rotan cada frame).
  maxSprites: 40,
  maxSpritesPerLine: 10,
  // Tipos de enemigo: weight = frecuencia relativa de aparicion, speed = multiplicador de enemySpeed.
  enemyTypes: {
    slime: { weight: 10, hp: 2, speed: 256, size: 8, flying: false, sprite: "enemyImage" },
    bigSlime: { weight: 1, hp: 4, speed: 128, size: 16, flying: false, sprite: "bigSlugImage" },
    bee: { weight: 3, hp: 1, speed: 1280, size: 8, flying: true, sprite: "beeImage" },
  },
  playerHp: 4,
  enemyHp: 2,
  invuln: 60,
  runAnimFrames: 6,
  pushAnimFrames: 8,
  pushUpFrames: 9,
  pushSideFrames: 30,
  enemyAnimFrames: 14,
  wavePause: 90,
};
// ------------------------------------------------------------ Ajustes del jugador (idioma y volumenes 0-5)
const settings = { lang: 0, master: 5, music: 4, sfx: 5 };
try { Object.assign(settings, JSON.parse(localStorage.getItem("raidersSettings") || "{}")); } catch (err) { /* sin almacenamiento */ }
function saveSettings() { try { localStorage.setItem("raidersSettings", JSON.stringify(settings)); } catch (err) { /* sin almacenamiento */ } }

