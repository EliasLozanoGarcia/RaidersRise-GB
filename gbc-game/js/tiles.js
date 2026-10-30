"use strict";
/* Capas del mapa, tiles compuestos, monedas y colisiones por tile. */

// ------------------------------------------------------------ Tablas de Colisiones
const COL_TOTAL = new Set([
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37,
  38, 39, 40, 41, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 94, 95, 96,
  97, 98, 99, 100, 101, 102, 103
]);

const COL_MEDIA = new Set([
  8, 9, 10, 11, 12, 13, 19, 20, 21, 22, 23, 42, 43, 44, 45, 46, 73, 104, 105
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

// ------------------------------------------------------------ Tiles compuestos (suelo + tile con transparencia)
// Los items con transparencia, las monedas y los avisos se dibujan como un unico tile pre-compuesto
// (suelo + item) en un buffer de tiles; el hueco se libera cuando el item desaparece.
const COMP_SLOTS = 96; // ids 160-255 (filas 6-8 del tileset, libres)
const COIN_TILE = 25, FALL_FRAMES = 6;
const ALERT_CHEST = 93, ALERT_CRYSTAL = [126, 127];
const compSlot = new Map(), compFree = [], coinAnim = new Map(), transparentTiles = new Set();
let compCv = null, compCtx = null;

function initComposites() {
  compCv = document.createElement("canvas");
  compCv.width = COMP_SLOTS * 8;
  compCv.height = 8;
  compCtx = compCv.getContext("2d");
  const ts = assets.tilesetImage;
  const cv = document.createElement("canvas");
  cv.width = ts.width;
  cv.height = ts.height;
  const c = cv.getContext("2d");
  c.drawImage(ts, 0, 0);
  const px = c.getImageData(0, 0, cv.width, cv.height).data;
  const cols = cv.width >> 3;
  for (let id = 0; id < cols * (cv.height >> 3); id++) {
    const x0 = (id % cols) * 8, y0 = ((id / cols) | 0) * 8;
    let clear = false;
    for (let y = 0; y < 8 && !clear; y++) for (let x = 0; x < 8; x++) if (px[((y0 + y) * cv.width + x0 + x) * 4 + 3] < 255) { clear = true; break; }
    if (clear) transparentTiles.add(id);
  }
  resetComposites();
}

const needsComposite = (id) => id >= 0 && compCtx !== null &&
  (transparentTiles.has(id) || id === COIN_TILE || id === ALERT_CHEST || id === ALERT_CRYSTAL[0] || id === ALERT_CRYSTAL[1]);

const fondoClear = (idx) => compCtx !== null && fondoLayer[idx] >= 0 && transparentTiles.has(fondoLayer[idx]);

// Suelo opaco que hay detras de un tile de fondo transparente: el mas frecuente entre sus vecinos.
function baseFloor(idx) {
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

function drawTileInto(c, id, attr, ox, oy) {
  c.save();
  c.translate(ox + 4, oy + 4);
 if (attr & 0x20) c.scale(-1, 1);
  if (attr & 0x40) c.scale(1, -1);
  c.drawImage(assets.tilesetImage, (id % 32) * 8, ((id / 32) | 0) * 8, 8, 8, -4, -4, 8, 8);
  c.restore();
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
  if (fondoClear(idx)) drawTileInto(compCtx, baseFloor(idx), 0, x, 0);
  if (fondoLayer[idx] >= 0) drawTileInto(compCtx, fondoLayer[idx], fondoAttrs[idx], x, 0);
  if (!noItem && itemsLayer[idx] >= 0) drawTileInto(compCtx, itemsLayer[idx], itemsAttrs[idx], x, dy);
  compCtx.restore();
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
  const dx = rnd(3) - 1, dy = rnd(2);
  const tries = [[dx, dy], [dx, 0], [0, dy], [0, 0]];
  for (const [ox, oy] of tries) {
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

