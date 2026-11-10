"use strict";
/* Niveles hechos a mano, posicion inicial y resetGame. */

// ------------------------------------------------------------ Niveles hechos a mano
let allLevels = [], levelLogic = null;

function useLayout(l) {
  MAP_W = l.w; MAP_H = l.h; // cada nivel puede tener su propio tamano (ej. 20x16)
  levelLogic = l.logic || null;
  fondoLayer = l.fondo.slice();
  fondoAttrs = l.fondoAttrs.slice();
  for (let i = 0; i < fondoLayer.length; i++) {
    if (fondoLayer[i] < 0) { fondoLayer[i] = 49; fondoAttrs[i] = 0; }
  }
  initialItemsLayer = l.items.slice();
  initialItemsAttrs = l.itemsAttrs.slice();
}

let layouts = [];
function buildLayouts() {
  layouts = shuffle(allLevels.slice());
}

// Posicion inicial de cada jugador: dentro del rectangulo "Start" del nivel, o fija si no lo tiene.
function startPos(i) {
  const s = levelLogic && levelLogic.start;
  if (!s) return [(MAP_W * 4) - 16 + i * 16, (MAP_H * 4) - 8]; // sin 'Start': centro del mapa
  return [Math.min(s[0] + i * 16, s[0] + s[2] - 16), s[1] + ((s[3] - 16) >> 1)];
}

function pickLevel() {
  const candidates = layouts.filter((l) => {
    const rewards = findMapRewards(l.items, l.w, l.h);
    return rewards.chest.length >= (isCrystalLevel(level) ? 3 : 2) &&
      (!isCrystalLevel(level) || rewards.crystal.length > 0);
  });
  if (!candidates.length) throw new Error(`No hay mapas compatibles con el botín del nivel ${level}.`);
  const preferred = layouts[(level - 1) % layouts.length];
  useLayout(candidates.includes(preferred) ? preferred : candidates[rnd(candidates.length)]);
}

function resetGame(keepUpgrades) {
  if (!keepUpgrades) { upg = {}; level = 1; buildLayouts(); }
  assets.tilesetImage = assets.biomeTilesets[biomeIndex(level)];
  scanTilesetTransparency();
  hitImages.tileset = makeHitImage(assets.tilesetImage);
  hitImages.transparentTileset = makeHitImage(transparentTilesetImage);
  pickLevel();
  shop = null;
  itemsLayer = initialItemsLayer.slice();
  barrierHp.clear();
  barrierHit.clear();
  tileOffY.clear();
  itemsAttrs = initialItemsAttrs.slice();
  for (let i = 0; i < MAP_W * MAP_H; i++) syncMapCell(i);
  players = [newPlayer(0, ...startPos(0)), newPlayer(1, ...startPos(1))];
  enemies = [];
  bullets = [];
  teleportEffects = [];
  specialExplosions = [];
  blasts.clear();
  wave = 0;
  gameOver = false;
  stats = { kills: 0, time: 0, shots: 0 };
  goSel = 0;
  paused = false;
  cam.x = Math.max(0, Math.min(MAP_W * 8 - 160, (players[0].x >> 8) + 8 - 80));
  cam.y = Math.max(0, Math.min(MAP_H * 8 - VIEW_H, (players[0].y >> 8) + 12 - (VIEW_H >> 1)));
  initInteractives();
  resetComposites();
  for (const p of players) unstickPlayer(p, true); // Start mal colocado (fuera del mapa/camara o sobre un muro)
  initSpawnPoints();
}
