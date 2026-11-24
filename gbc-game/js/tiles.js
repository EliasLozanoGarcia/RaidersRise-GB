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
  38, 39, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 94, 95, 96,
  84, 85, 86, 97, 98, 99, 100, 101, 102, 103, 116, 117, 118,
  74, 75, 76, 77, 106, 107, 108, 109 // muros bajables (fases 0 y 1)
]);

const COL_MEDIA = new Set([
  8, 9, 10, 11, 12, 13, 19, 21, 23, 30, 31, 40, 41, 42, 43, 44, 45, 58, 73, 104, 105, 126, 127,
  110, 111 // muro bajable, ultima fase: bloquea el paso pero no a los enemigos voladores
]);

let itemsLayer = [];
let fondoLayer = [];
let itemsAttrs = [];
let fondoAttrs = [];
let initialItemsLayer = [];
let initialItemsAttrs = [];

function syncMapCell(idx) {
  const itemTile = itemsLayer[idx];
  const hasItem = itemTile >= 0 && !LUCKY_DROPS.includes(itemTile);
  const tileId = hasItem ? itemTile : fondoLayer[idx];
  if (gbc && gbc.mapTile) {
    gbc.mapTile[0][idx] = tileId >= 0 ? tileId : 0;
    gbc.mapAttr[0][idx] = hasItem ? itemsAttrs[idx] : fondoAttrs[idx];
    const tx = idx % MAP_W, ty = (idx / MAP_W) | 0;
    const mi = ty * 32 + tx;
    if (mi < 1024) {
      gbc.mapTile[0][mi] = tileId >= 0 ? tileId : 0;
      gbc.mapAttr[0][mi] = hasItem ? itemsAttrs[idx] : fondoAttrs[idx];
    }
  }
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
const PICKUP = { heart: 152, coin: 153, mana: 154, crystal: 155, shield: 160, key: 161, grenade: 162 };
const LUCKY_DROPS = Object.values(PICKUP);
const coinChanceTenths = () => Math.max(1, 11 - level);
const COIN_TILE = PICKUP.coin, FALL_FRAMES = 6;
const ALERT_CHEST = 93, ALERT_CRYSTAL = [126, 127];
const FLOOR_COMPOSITE_TILES = new Set([64, 65, 66, 67, 69, 70, 71, 72]);
const URBAN_FLOOR_COMPOSITE_TILES = new Set([70, 71, 72]);
const floorCompositeTiles = () => assets.tilesetImage === assets.biomeTilesets[0]
  ? URBAN_FLOOR_COMPOSITE_TILES : FLOOR_COMPOSITE_TILES;
const isFloorCompositeTile = (id) => floorCompositeTiles().has(id);
const compSlot = new Map(), compFree = [], coinAnim = new Map(), transparentTiles = new Set();
const compTiles = [];
let compCtx = null;
let transparentTilesetImage = null;

function beginCompositeCapture(kind) {
  const biome = assets.biomeTilesets.indexOf(assets.tilesetImage);
  if (biome < 0 || biome > 2) throw new Error("Bioma desconocido al buscar un tile compuesto");
  return { biome: ["urban", "desert", "snow"][biome], kind, layers: [] };
}

function captureCompositeLayer(recipe, source, id, attr, x, y) {
  let name;
  const biome = assets.biomeTilesets.indexOf(source);
  if (biome >= 0 && biome < 3) name = ["urban", "desert", "snow"][biome];
  else if (source === transparentTilesetImage) name = "biome-transparent";
  else if (source === hitImages.tileset) name = "biome-hit";
  else if (source === hitImages.transparentTileset) name = "biome-transparent-hit";
  else if (source === hitImages.luckyTileset) name = "biome-lucky-hit";
  else if (source === assets.pickupTileset) name = "pickups";
  else throw new Error("Imagen desconocida al buscar un tile compuesto");
  recipe.layers.push({ source: name, tile: id, attr: attr & 0x60, x, y });
}

function initPickupTiles() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  const urban = assets.urbanTransparentTileset || assets.biomeTilesets[0], legacy = assets.biomeTilesets[1];
  for (const [id, source, tile] of [
    [PICKUP.heart, urban, 152], [PICKUP.coin, urban, 153],
    [PICKUP.mana, urban, 154], [PICKUP.crystal, urban, 155],
    [PICKUP.shield, legacy, 150], [PICKUP.key, legacy, 151], [PICKUP.grenade, legacy, 152]
  ]) {
    ctx.drawImage(source, (tile % 32) * 8, (tile >> 5) * 8, 8, 8,
      (id % 32) * 8, (id >> 5) * 8, 8, 8);
  }
  assets.pickupTileset = canvas;
}

function initComposites() {
  compCtx = {};
  scanTilesetTransparency();
  resetComposites();
}

function scanTilesetTransparency() {
  transparentTiles.clear();
  const ts = assets.tilesetImage;
  const urban = ts === assets.biomeTilesets[0];
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
    if (clear && !urban) transparentTiles.add(id);
  }
  const floorOffset = (((49 / cols) | 0) * 8 * cv.width + (49 % cols) * 8) * 4;
  for (const id of floorCompositeTiles()) {
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
  (transparentTiles.has(id) || id === ALERT_CHEST || id === ALERT_CRYSTAL[0] || id === ALERT_CRYSTAL[1]);

const fondoClear = (idx) => compCtx !== null && fondoLayer[idx] >= 0 && transparentTiles.has(fondoLayer[idx]);

// Suelo opaco que hay detras de un tile de fondo transparente: el mas frecuente entre sus vecinos.
function baseFloor(idx) {
  if (isFloorCompositeTile(fondoLayer[idx])) return 49;
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
  compTiles.length = 0;
  compFree.length = 0;
  for (let i = COMP_SLOTS - 1; i >= 0; i--) compFree.push(i);
  for (let idx = 0; idx < itemsLayer.length; idx++) if (needsComposite(itemsLayer[idx]) || fondoClear(idx)) setComposite(idx, 0);
  if (typeof syncAllCompositesToVram === "function") syncAllCompositesToVram();
}

function drawTileInto(recipe, id, attr, ox, oy, image = assets.tilesetImage) {
  let source = image;
  if (isFloorCompositeTile(id) && transparentTilesetImage) {
    if (image === assets.tilesetImage) source = transparentTilesetImage;
    else if (image === hitImages.tileset && hitImages.transparentTileset) source = hitImages.transparentTileset;
  }
  captureCompositeLayer(recipe, source, id, attr, ox, oy);
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

// Busca el tile pregenerado de suelo + item; dy desplaza el item un pixel.
function setComposite(idx, dy, noItem = false) {
  let slot = compSlot.get(idx);
  if (slot === undefined) {
    if (!compFree.length) return false;
    slot = compFree.pop();
    compSlot.set(idx, slot);
  }
  const recipe = beginCompositeCapture("normal");
  if (isFloorCompositeTile(itemsLayer[idx]) && !noItem) {
    drawTileInto(recipe, 49, 0, 0, 0);
  } else {
    if (fondoClear(idx)) drawTileInto(recipe, baseFloor(idx), 0, 0, 0);
    if (fondoLayer[idx] >= 0) drawTileInto(recipe, fondoLayer[idx], fondoAttrs[idx], 0, 0);
  }
  if (!noItem && itemsLayer[idx] >= 0 && !LUCKY_DROPS.includes(itemsLayer[idx]))
    drawItemInto(recipe, itemsLayer[idx], itemsAttrs[idx], 0, dy);
  compTiles[slot] = window.CompositeTiles.resolve(recipe);
  if (typeof updateCompositeVram === "function") updateCompositeVram(slot);
  return true;
}

// El marcador reemplaza el suelo, pero conserva encima los elementos transparentes.
function drawSpecialComposite(ctx, idx, id, attr, x, y, itemImage = assets.tilesetImage, floorImage = assets.tilesetImage) {
  if (!fondoClear(idx) && !needsComposite(itemsLayer[idx])) return false;
  const recipe = beginCompositeCapture("special-fallback");
  drawTileInto(recipe, id, attr, 0, 0, floorImage);
  if (fondoClear(idx) && !isFloorCompositeTile(itemsLayer[idx]))
    drawTileInto(recipe, fondoLayer[idx], fondoAttrs[idx], 0, 0);
  if (itemsLayer[idx] >= 0 && !coinWaiting(idx) && !LUCKY_DROPS.includes(itemsLayer[idx])) {
    const coin = coinAnim.get(idx);
    const dy = coin && coin.fall ? -1 : 0;
    drawItemInto(recipe, itemsLayer[idx], itemsAttrs[idx], 0, dy, itemImage);
  }
  window.CompositeTiles.draw(ctx, window.CompositeTiles.resolve(recipe), x, y);
  return true;
}

function buildSpecialComposite(idx, id, attr, itemImage = assets.tilesetImage, floorImage = assets.tilesetImage) {
  const recipe = beginCompositeCapture("special");
  const transparentFloor = fondoClear(idx) && !isFloorCompositeTile(itemsLayer[idx]);
  if (!transparentFloor && fondoLayer[idx] >= 0)
    drawTileInto(recipe, fondoLayer[idx], fondoAttrs[idx], 0, 0, floorImage);
  drawTileInto(recipe, id, attr, 0, 0, floorImage);
  if (transparentFloor) drawTileInto(recipe, fondoLayer[idx], fondoAttrs[idx], 0, 0);
  if (itemsLayer[idx] >= 0 && !coinWaiting(idx) && !LUCKY_DROPS.includes(itemsLayer[idx])) {
    const coin = coinAnim.get(idx);
    const dy = coin && coin.fall ? -1 : 0;
    drawItemInto(recipe, itemsLayer[idx], itemsAttrs[idx], 0, dy, itemImage);
  }
  return window.CompositeTiles.resolve(recipe);
}

function releaseComposite(idx) {
  const slot = compSlot.get(idx);
  if (slot === undefined) return;
  compSlot.delete(idx);
  compTiles[slot] = undefined;
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
