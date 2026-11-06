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
  teleportOffset: 8,
  hurtFlash: 6,
  barrierHp: 1, // impactos por estado de dano de las barreras (3 estados: 19/20 -> 21/22 -> 23/24 -> destruida)
  bulletSpeed: 3 * 256,
  bulletRange: 88,
  bulletGroundOffset: 6,
  bulletHitPad: 2,       // px a cada lado de la bala al impactar enemigos/objetos (caja de 2*pad+1 px, no un punto)
  bulletEdgeSlack: 2,    // px de margen en los bordes de las paredes: si la bala solo roza una esquina, pasa
  bulletLinger: 4, // frames que la bala sigue avanzando tras chocar con pared/objeto, antes de desaparecer
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
  luckyBoxCount: 4,
  shieldFrames: 300, // cinco segundos a 60 actualizaciones por segundo
  // Cantidad de enemigos por oleada: waveBase + (oleada-1) * wavePerWave, hasta waveMax.
  waveBase: 30,
  wavePerWave: 10,
  waveMax: 120,
  // Limites de dibujado tipo Game Boy: si se superan, los sobrantes parpadean (rotan cada frame).
  maxSprites: 40,
  maxSpritesPerLine: 10,
  // Tipos de enemigo (clave = nombre usable en customSpawners.type de los Logic.json):
  //   weight = frecuencia relativa de aparicion, speed = multiplicador de enemySpeed, size = 8 o 16 px,
  //   ai = "walk" (persigue/vaga) | "fly" (vuelo errático), coin = suelta moneda al morir,
  //   sheet = "dir" (columna por direccion, 2 frames) | "flap" (2 frames de 8x8 de aleteo).
  enemyTypes: {
    slime: { weight: 10, hp: 2, speed: 256, size: 8, flying: false, sprite: "enemyImage", ai: "walk", coin: true, sheet: "dir" },
    bigSlime: { weight: 1, hp: 4, speed: 128, size: 16, flying: false, sprite: "bigSlugImage", ai: "walk", coin: true, sheet: "dir" },
    bee: { weight: 3, hp: 1, speed: 1280, size: 8, flying: true, sprite: "beeImage", ai: "fly", coin: false, sheet: "flap" },
  },
  playerHp: 4,
  invuln: 60,
  runAnimFrames: 6,
  pushUpFrames: 9,
  pushSideFrames: 30,
  enemyAnimFrames: 14,
  wavePause: 90,
};
// ------------------------------------------------------------ Ajustes del jugador (idioma y volumenes 0-5)
const settings = { lang: 0, master: 5, music: 4, sfx: 5 };
try { Object.assign(settings, JSON.parse(localStorage.getItem("raidersSettings") || "{}")); } catch (err) { /* sin almacenamiento */ }
function saveSettings() { try { localStorage.setItem("raidersSettings", JSON.stringify(settings)); } catch (err) { /* sin almacenamiento */ } }
