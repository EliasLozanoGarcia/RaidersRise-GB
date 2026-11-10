"use strict";
/* Capas del mapa, tiles compuestos, monedas y colisiones por tile. */

// ------------------------------------------------------------ Tablas de Colisiones
// Nuevas colisiones de medio tile (T: Arriba, R: Derecha, D: Abajo, L: Izquierda)
const COL_TOTAL_T = new Set([20, 22, 24, 36]);
const COL_TOTAL_R = new Set([]); // Añade aquí los IDs de mitad derecha total si tienes
const COL_TOTAL_D = new Set([64, 65, 76, 77]);
const COL_TOTAL_L = new Set([70, 71]);

const COL_MEDIA_T = new Set([]); // Añade aquí los IDs de mitad arriba media
const COL_MEDIA_R = new Set([]); // Añade aquí los IDs de mitad derecha media
const COL_MEDIA_D = new Set([30, 31, 126, 127]);
const COL_MEDIA_L = new Set([]); // Añade aquí los IDs de mitad izquierda media

const COL_TOTAL = new Set([
  0, 1, 2, 3, 4, 5, 6, 7, 27, 28, 29, 32, 33, 34, 35, 36, 37,
  38, 39, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 94, 95, 96,
  97, 98, 99, 100, 101, 102, 103,
  74, 75, 76, 77, 106, 107, 108, 109 // muros bajables (fases 0 y 1)
]);

const COL_MEDIA = new Set([
  8, 9, 10, 11, 12, 13, 19, 21, 23, 30, 31, 40, 41, 42, 43, 44, 45, 73, 104, 105, 126, 127,
  110, 111 // muro bajable, ultima fase: bloquea el paso pero no las balas ni cosas que vuelen
]);

let itemsLayer = [];
let fondoLayer = [];
let itemsAttrs = [];
let fondoAttrs = [];
let initialItemsLayer = [];
let initialItemsAttrs = [];

function syncMapCell(idx) {
  const itemTile = itemsLayer[idx];
  const hasItem = itemTile >= 0;
  const tileId = hasItem ? itemTile : fondoLayer[idx];
  gbc.mapTile[0][idx] = tileId >= 0 ? tileId : 0;
  gbc.mapAttr[0][idx] = hasItem ? itemsAttrs[idx] : fondoAttrs[idx];
}

function setItemTile(idx, gid, attr = 0) {
  itemsLayer[idx] = gid;
  itemsAttrs[idx] = attr;
  coinAnim.delete(idx);
  releaseComposite(idx);
  syncMapCell(idx);
  if (needsComposite(gid) || fondoClear(idx)) setComposite(idx, 0);
}

function setFloorTile(idx, gid, attr = 0) {
  fondoLayer[idx] = gid;
  fondoAttrs[idx] = attr;
  releaseComposite(idx);
  syncMapCell(idx);
  if (needsComposite(itemsLayer[idx]) || fondoClear(idx)) {
    const coin = coinAnim.get(idx);
    setComposite(idx, coin && coin.fall ? -1 : 0, !!coin && !coin.fall);
  }
}

// ------------------------------------------------------------ Tiles compuestos (suelo + tile con transparencia)
// Los items con transparencia, las monedas y los avisos se dibujan como un unico tile pre-compuesto
// (suelo + item) en un buffer de tiles; el hueco se libera cuando el item desaparece.
const COMP_SLOTS = 96; // ids 160-255 (filas 6-8 del tileset, libres)
// Los IDs del tileset son uno menos que los numeros mostrados en Tiled.
const PICKUP = { heart: 146, coin: 147, mana: 148, crystal: 149, shield: 150, key: 151, grenade: 152 };
const LUCKY_DROPS = Object.values(PICKUP);
const coinChanceTenths = () => Math.max(1, 11 - level);
const COIN_TILE = PICKUP.coin, FALL_FRAMES = 6;
const ALERT_CHEST = 93, ALERT_CRYSTAL = [126, 127];
const FLOOR_COMPOSITE_TILES = new Set([64, 65, 66, 67, 69, 70, 71, 72]);
const compSlot = new Map(), compFree = [], coinAnim = new Map(), transparentTiles = new Set();
let compCv = null, compCtx = null;
let specialCompCv = null, specialCompCtx = null;
let transparentTilesetImage = null;

function initComposites() {
  compCv = document.createElement("canvas");
  compCv.width = COMP_SLOTS * 8;
  compCv.height = 8;
  compCtx = compCv.getContext("2d");
  scanTilesetTransparency();
  resetComposites();
}

function scanTilesetTransparency() {
  transparentTiles.clear();
  const ts = assets.tilesetImage;
  const cv = document.createElement("canvas");
  cv.width = ts.width;
  cv.height = ts.height;
  const c = cv.getContext("2d");
  c.drawImage(ts, 0, 0);
  const imageData = c.getImageData(0, 0, cv.width, cv.height);
  const px = imageData.data;
  const cols = cv.width >> 3;
  for (let id = 0; id < cols * (cv.height >> 3); id++) {
    const x0 = (id % cols) * 8, y0 = ((id / cols) | 0) * 8;
    let clear = false;
    for (let y = 0; y < 8 && !clear; y++) for (let x = 0; x < 8; x++) if (px[((y0 + y) * cv.width + x0 + x) * 4 + 3] < 255) { clear = true; break; }
    if (clear) transparentTiles.add(id);
  }
  const floorOffset = (((49 / cols) | 0) * 8 * cv.width + (49 % cols) * 8) * 4;
  for (const id of FLOOR_COMPOSITE_TILES) {
    const x0 = (id % cols) * 8, y0 = ((id / cols) | 0) * 8;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const p = ((y0 + y) * cv.width + x0 + x) * 4;
      if (px[p] === px[floorOffset] && px[p + 1] === px[floorOffset + 1] &&
          px[p + 2] === px[floorOffset + 2] && px[p + 3] === px[floorOffset + 3]) px[p + 3] = 0;
    }
    transparentTiles.add(id);
  }
  c.putImageData(imageData, 0, 0);
  transparentTilesetImage = cv;
}

const needsComposite = (id) => id >= 0 && compCtx !== null &&
  (transparentTiles.has(id) || id === COIN_TILE || id === ALERT_CHEST || id === ALERT_CRYSTAL[0] || id === ALERT_CRYSTAL[1]);

const fondoClear = (idx) => compCtx !== null && fondoLayer[idx] >= 0 && transparentTiles.has(fondoLayer[idx]);

// Suelo opaco que hay detras de un tile de fondo transparente: el mas frecuente entre sus vecinos.
function baseFloor(idx) {
  if (FLOOR_COMPOSITE_TILES.has(fondoLayer[idx])) return 49;
  const tx = idx % MAP_W, ty = (idx / MAP_W) | 0, cnt = new Map();
  for (const [ox, oy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
    const x = tx + ox, y = ty + oy;
    if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) continue;
    const id = fondoLayer[y * MAP_W + x];
    if (id >= 0 && !transparentTiles.has(id)) cnt.set(id, (cnt.get(id) || 0) + 1);
  }
  let best = 49, bc = 0;
  for (const [id, c] of cnt) if (c > bc) { best = id; bc = c; }
  return best;
}

function resetComposites() {
  coinAnim.clear();
  compSlot.clear();
  compFree.length = 0;
  for (let i = COMP_SLOTS - 1; i >= 0; i--) compFree.push(i);
  for (let idx = 0; idx < itemsLayer.length; idx++) if (needsComposite(itemsLayer[idx]) || fondoClear(idx)) setComposite(idx, 0);
}

function drawTileInto(c, id, attr, ox, oy, image = assets.tilesetImage) {
  c.save();
  c.translate(ox + 4, oy + 4);
  if (attr & 0x20) c.scale(-1, 1);
  if (attr & 0x40) c.scale(1, -1);
  let source = image;
  if (FLOOR_COMPOSITE_TILES.has(id) && transparentTilesetImage) {
    if (image === assets.tilesetImage) source = transparentTilesetImage;
    else if (image === hitImages.tileset && hitImages.transparentTileset) source = hitImages.transparentTileset;
  }
  c.drawImage(source, (id % 32) * 8, ((id / 32) | 0) * 8, 8, 8, -4, -4, 8, 8);
  c.restore();
}

function itemTileParts(id, attr) {
  if (id === ALERT_CHEST) return [[29, attr], [93, attr]];
  if (id === ALERT_CRYSTAL[0]) return [[30, attr], [93, 0x20]];
  if (id === ALERT_CRYSTAL[1]) return [[31, attr], [93, 0]];
  return [[id, attr]];
}

function drawItemInto(c, id, attr, x, y, image = assets.tilesetImage) {
  for (const [part, flags] of itemTileParts(id, attr)) drawTileInto(c, part, flags, x, y, image);
}

// Compone suelo + item en el hueco de la celda; dy desplaza el item (1 pixel arriba = -1).
function setComposite(idx, dy, noItem = false) {
  let slot = compSlot.get(idx);
  if (slot === undefined) {
    if (!compFree.length) return false;
    slot = compFree.pop();
    compSlot.set(idx, slot);
  }
  const x = slot * 8;
  compCtx.clearRect(x, 0, 8, 8);
  compCtx.save();
  compCtx.beginPath();
  compCtx.rect(x, 0, 8, 8);
  compCtx.clip();
  if (FLOOR_COMPOSITE_TILES.has(itemsLayer[idx]) && !noItem) {
    drawTileInto(compCtx, 49, 0, x, 0);
  } else {
    if (fondoClear(idx)) drawTileInto(compCtx, baseFloor(idx), 0, x, 0);
    if (fondoLayer[idx] >= 0) drawTileInto(compCtx, fondoLayer[idx], fondoAttrs[idx], x, 0);
  }
  if (!noItem && itemsLayer[idx] >= 0) drawItemInto(compCtx, itemsLayer[idx], itemsAttrs[idx], x, dy);
  compCtx.restore();
  return true;
}

// El marcador reemplaza el suelo, pero conserva encima los elementos transparentes.
function drawSpecialComposite(ctx, idx, id, attr, x, y, itemImage = assets.tilesetImage) {
  if (!fondoClear(idx) && !needsComposite(itemsLayer[idx])) return false;
  if (!specialCompCtx) {
    specialCompCv = document.createElement("canvas");
    specialCompCv.width = specialCompCv.height = 8;
    specialCompCtx = specialCompCv.getContext("2d");
  }
  const c = specialCompCtx;
  c.clearRect(0, 0, 8, 8);
  c.save();
  c.beginPath();
  c.rect(0, 0, 8, 8);
  c.clip();
  drawTileInto(c, id, attr, 0, 0);
  if (fondoClear(idx) && !FLOOR_COMPOSITE_TILES.has(itemsLayer[idx]))
    drawTileInto(c, fondoLayer[idx], fondoAttrs[idx], 0, 0);
  if (itemsLayer[idx] >= 0 && !coinWaiting(idx)) {
    const coin = coinAnim.get(idx);
    const dy = coin && coin.fall ? -1 : 0;
    drawItemInto(c, itemsLayer[idx], itemsAttrs[idx], 0, dy, itemImage);
  }
  c.restore();
  ctx.drawImage(specialCompCv, x, y);
  return true;
}

function releaseComposite(idx) {
  const slot = compSlot.get(idx);
  if (slot === undefined) return;
  compSlot.delete(idx);
  compFree.push(slot);
}

// Cada moneda cae en su celda o, al azar, un tile a izquierda/derecha y/o uno mas abajo (si esta libre),
// y se voltea al azar (espejo) para que no queden todas iguales.
function pickCoinCell(idx) {
  const tx0 = idx % MAP_W, ty0 = (idx / MAP_W) | 0;
  // Solo permite desplazamientos a los lados (dx: -1, 0, 1) y hacia abajo (dy: 0, 1), nunca arriba (dy < 0)
  const dirs = shuffle([[-1, 0], [1, 0], [0, 1], [-1, 1], [1, 1], [0, 0]]);
  for (const [ox, oy] of dirs) {
    const tx = tx0 + ox, ty = ty0 + oy;
    if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) continue;
    const t = ty * MAP_W + tx;
    if (itemsLayer[t] === -1 && getCellCollision(tx, ty) === 0) return t;
  }
  return -1;
}

// Una moneda cae: primero el tile con la moneda 1 px arriba (0,1 s) y despues en su sitio.
// Con mas de 2 monedas a la vez se sueltan en grupos de 1-3 separados por 1-2 frames.
function spawnCoins(cells) {
  let delay = 0;
  for (let i = 0; i < cells.length;) {
    const n = cells.length > 2 ? 1 + rnd(3) : cells.length;
    for (let k = 0; k < n && i < cells.length; k++, i++) {
      const idx = pickCoinCell(cells[i]);
      if (idx < 0) continue;
      releaseComposite(idx);
      itemsLayer[idx] = COIN_TILE;
      itemsAttrs[idx] = rnd(2) ? 0x20 : 0;
      syncMapCell(idx);
      if (fondoClear(idx)) setComposite(idx, 0, true);
      coinAnim.set(idx, { delay, fall: false, t: 0 });
    }
    delay += 1 + rnd(2);
  }
}

function updateCoins() {
  for (const [idx, a] of coinAnim) {
    if (a.delay > 0) { a.delay--; if (a.delay > 0) continue; }
    if (!a.fall) {
      a.fall = true;
      if (!setComposite(idx, -1)) coinAnim.delete(idx);
    } else if (++a.t >= FALL_FRAMES) {
      setComposite(idx, 0);
      coinAnim.delete(idx);
    }
  }
}
const coinWaiting = (idx) => { const a = coinAnim.get(idx); return a !== undefined && !a.fall; };
