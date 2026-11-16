"use strict";
/* Renderizado: imagenes golpeadas, texto, HUD, tienda, game over y render(). */

const hitImages = {};
const HIT_RAMP = [0x0f380f, 0x2a4e19, 0x55742a, 0x7a953a];
function makeHitImage(img, brighten = false) {
  try {
    const cv = document.createElement("canvas");
    cv.width = img.width;
    cv.height = img.height;
    const c = cv.getContext("2d");
    c.drawImage(img, 0, 0);
    const data = c.getImageData(0, 0, cv.width, cv.height);
    const px = data.data;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] === 0) continue;
      if (brighten) {
        for (let j = 0; j < 3; j++) px[i + j] = Math.min(255, px[i + j] + 110);
        continue;
      }
      const k = HIT_RAMP.indexOf((px[i] << 16) | (px[i + 1] << 8) | px[i + 2]);
      if (k < 0) continue;
      const n = HIT_RAMP[HIT_RAMP.length - 1 - k];
      px[i] = n >> 16; px[i + 1] = (n >> 8) & 255; px[i + 2] = n & 255;
    }
    c.putImageData(data, 0, 0);
    return cv;
  } catch (err) {
    return img;
  }
}

function makeEnemyHitImages(images) {
  const sheets = Object.entries(images).map(([key, img]) => {
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    return { key, canvas, ctx, data: ctx.getImageData(0, 0, canvas.width, canvas.height) };
  });
  const colors = new Set();
  for (const { data } of sheets) {
    const px = data.data;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3]) colors.add((px[i] << 16) | (px[i + 1] << 8) | px[i + 2]);
    }
  }
  const lighter = lighterPalette(colors, "enemigos");
  const result = {};
  for (const { key, canvas, ctx, data } of sheets) {
    const px = data.data;
    for (let i = 0; i < px.length; i += 4) {
      if (!px[i + 3]) continue;
      const color = lighter.get((px[i] << 16) | (px[i + 1] << 8) | px[i + 2]);
      px[i] = color >> 16; px[i + 1] = (color >> 8) & 255; px[i + 2] = color & 255;
    }
    ctx.putImageData(data, 0, 0);
    result[key] = canvas;
  }
  return result;
}

function lighterPalette(colors, name) {
  const brightness = (color) => 299 * (color >> 16) + 587 * ((color >> 8) & 255) + 114 * (color & 255);
  const palette = [...colors].sort((a, b) => brightness(a) - brightness(b));
  if (palette.length !== 4) throw new Error(`La paleta de ${name} debe tener 4 colores; tiene ${palette.length}`);
  return new Map(palette.map((color, i) => [color, palette[Math.min(i + 1, palette.length - 1)]]));
}

function makeLuckyHitImage(img) {
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = data.data, colors = new Set();
  for (const id of [27, 28, 59, 60]) {
    const tx = (id % 32) * 8, ty = (id >> 5) * 8;
    for (let y = ty; y < ty + 8; y++) for (let x = tx; x < tx + 8; x++) {
      const i = (y * canvas.width + x) * 4;
      if (pixels[i + 3]) colors.add((pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2]);
    }
  }
  const lighter = lighterPalette(colors, "lucky blocks");
  for (let i = 0; i < pixels.length; i += 4) {
    if (!pixels[i + 3]) continue;
    const color = lighter.get((pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2]);
    if (color === undefined) continue;
    pixels[i] = color >> 16; pixels[i + 1] = (color >> 8) & 255; pixels[i + 2] = color & 255;
  }
  ctx.putImageData(data, 0, 0);
  return canvas;
}

function drawMapTile(ctx, tx, ty, tileId, attr, hit = false, dy = 0, dx = 0, hitImage = null, normalImage = null) {
  if (tileId < 0) return;
  const screenX = tx * 8 - cam.x + dx;
  const screenY = ty * 8 - cam.y + dy;
  const sourceX = (tileId % 32) * 8;
  const sourceY = (tileId >> 5) * 8;
  const flags = attr || 0;
  ctx.save();
  ctx.translate(screenX + 4, screenY + 4);
  if (flags & 0x20) ctx.scale(-1, 1);
  if (flags & 0x40) ctx.scale(1, -1);
  const image = FLOOR_COMPOSITE_TILES.has(tileId) && transparentTilesetImage
    ? (hit && hitImages.transparentTileset ? hitImages.transparentTileset : transparentTilesetImage)
    : (hit ? hitImage || hitImages.tileset || normalImage || assets.tilesetImage : normalImage || assets.tilesetImage);
  ctx.drawImage(image, sourceX, sourceY, 8, 8, -4, -4, 8, 8);
  ctx.restore();
}

function drawSpecialTile(ctx, cell, id, attr, hit = false, hitImage = null, floorImage = assets.tilesetImage) {
  const idx = cell.ty * MAP_W + cell.tx;
  const parts = specialFreeParts(cell.tx, cell.ty);
  if (!parts.length) return;
  const x = cell.tx * 8 - cam.x, y = cell.ty * 8 - cam.y;
  ctx.save();
  if (parts.length < 4) {
    ctx.beginPath();
    for (const part of parts) ctx.rect(x + part.x, y + part.y, 4, 4);
    ctx.clip();
  }
  if (cell.id === 88 && id !== 88) {
    ctx.beginPath();
    const flipX = (cell.attr & 0x20) !== 0, flipY = (cell.attr & 0x40) !== 0;
    const point = (px, py) => [x + (flipX ? 8 - px : px), y + (flipY ? 8 - py : py)];
    const a = point(0, 8), b = point(8, 0), c = point(8, 8);
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.lineTo(c[0], c[1]);
    ctx.closePath();
    ctx.clip();
  }
  const itemImage = hit ? hitImage || hitImages.tileset || assets.tilesetImage : assets.tilesetImage;
  if (!drawSpecialComposite(ctx, idx, id, attr, x, y, itemImage, floorImage)) {
    drawMapTile(ctx, cell.tx, cell.ty, id, attr, false, 0, 0, null, floorImage);
    if (itemsLayer[idx] >= 0 && !coinWaiting(idx)) {
      for (const [part, flags] of itemTileParts(itemsLayer[idx], itemsAttrs[idx]))
        drawMapTile(ctx, cell.tx, cell.ty, part, flags, hit,
          tileOffY.get(idx) || 0, tileOffX.get(idx) || 0,
          LUCKY_DROPS.includes(itemsLayer[idx]) ? hitImages.pickups : hitImage,
          LUCKY_DROPS.includes(itemsLayer[idx]) ? assets.pickupTileset : null);
    }
  }
  ctx.restore();
}

// ------------------------------------------------------------ HUD (3 tiles de alto, parte inferior)
const GLYPH_COIN = PICKUP.coin, GLYPH_DIGIT0 = 127; // digitos: 128-136 = 1-9, 137 = 0

// Texto: los glifos de la fuente 8x8 (ancho proporcional) se componen en 32 tiles libres del tileset
// (ids 74-92 y 106-118, transparentes en el PNG) y despues se pintan como tiles.
const FONT_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,ñ";
const EXTRA_FONT_CHARS = "/©";
const EXTRA_GLYPHS = [
  ["0000010", "0000100", "0000100", "0001000", "0010000", "0010000", "0100000"],
  ["0111110", "1000001", "1011101", "1010001", "1011101", "1000001", "0111110"],
];
const TEXT_IDS = [];
for (let i = 74; i <= 92; i++) TEXT_IDS.push(i);
for (let i = 106; i <= 118; i++) TEXT_IDS.push(i);
const TEXT_TILES = TEXT_IDS.length, SPACE_W = 3;
const TEXT_SLOT = new Map(TEXT_IDS.map((id, i) => [id, i]));
const fontGlyphs = {};
let tileBufCtx = null, lastText = null;

function initText() {
  // Buffer de texto: solo la fila de texto del tileset; el tileset original no se toca (los mapas se dibujan desde la imagen).
  const cv = document.createElement("canvas");
  cv.width = TEXT_TILES * 8;
  cv.height = 8;
  tileBufCtx = cv.getContext("2d");
  assets.textBuffer = cv;

  const f = document.createElement("canvas");
  f.width = assets.fontImage.width;
  f.height = assets.fontImage.height + 8;
  const fc = f.getContext("2d");
  fc.drawImage(assets.fontImage, 0, 0);
  fc.fillStyle = "#fff";
  EXTRA_GLYPHS.forEach((glyph, i) => glyph.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === "1") fc.fillRect(i * 8 + x, assets.fontImage.height + y, 1, 1);
  }));
  const data = fc.getImageData(0, 0, f.width, f.height).data;
  fc.globalCompositeOperation = "source-in";
  fc.fillStyle = "#7a953a";
  fc.fillRect(0, 0, f.width, f.height);
  assets.fontTinted = f;
  const allFontChars = FONT_CHARS + EXTRA_FONT_CHARS;
  for (let n = 0; n < allFontChars.length; n++) {
    const extraIndex = n - FONT_CHARS.length;
    const cx = n < FONT_CHARS.length ? (n % 8) * 8 : extraIndex * 8;
    const cy = n < FONT_CHARS.length ? (n >> 3) * 8 : assets.fontImage.height;
    let x0 = 8, x1 = -1;
    for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) {
      if (data[((cy + y) * f.width + cx + x) * 4 + 3]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
    }
    fontGlyphs[allFontChars[n]] = x1 < 0 ? { sx: cx, sy: cy, w: 0 } : { sx: cx + x0, sy: cy, w: x1 - x0 + 1 };
  }
}

const textNorm = (str) => String(str).normalize("NFD").replace(/n\u0303/g, "ñ").replace(/[\u0300-\u036f]/g, "");
function textWidth(str) {
  let w = 0;
  for (const ch of textNorm(str)) w += fontGlyphs[ch] ? fontGlyphs[ch].w + 1 : SPACE_W + 1;
  return Math.max(0, w - 1);
}

function drawText(ctx, str, x, y) {
  const s = textNorm(str);
  const w = textWidth(s);
  if (!w || !tileBufCtx) return;
  if (s !== lastText) {
    tileBufCtx.clearRect(0, 0, TEXT_TILES * 8, 8);
    let pen = 0;
    for (const ch of s) {
      const g = fontGlyphs[ch];
      if (g && g.w) tileBufCtx.drawImage(assets.fontTinted, g.sx, g.sy, g.w, 8, pen, 0, g.w, 8);
      pen += g ? g.w + 1 : SPACE_W + 1;
      if (pen >= TEXT_TILES * 8) break;
    }
    lastText = s;
  }
  const tiles = Math.min(TEXT_TILES, Math.ceil(w / 8));
  for (let i = 0; i < tiles; i++) drawGlyph(ctx, TEXT_IDS[i], x + i * 8, y);
}
const drawTextCentered = (ctx, str, y, cx = GBC_W >> 1) => drawText(ctx, str, cx - (textWidth(str) >> 1), y);

function wrapText(str, maxW) {
  const lines = [];
  let line = "";
  for (const word of str.split(" ")) {
    const t = line ? line + " " + word : word;
    if (line && textWidth(t) > maxW) { lines.push(line); line = word; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

function drawShop(ctx) {
  ctx.fillStyle = "#0f380f";
  ctx.fillRect(0, 0, GBC_W, GBC_H);
  const center = (str, y) => drawTextCentered(ctx, str, y);
  center("LEVEL WIN", 6);
  drawGlyph(ctx, GLYPH_COIN, 56, 20);
  drawText(ctx, String(totalCoins()), 64, 20);
  const coins = totalCoins();
  shop.offers.forEach((u, i) => {
    const y = 44 + i * 20;
    const afford = upgCost(u) <= coins;
    ctx.globalAlpha = afford ? 1 : 0.4;
    drawText(ctx, u.name, 14, y);
    const lvl = "NV" + lv(u.key);
    drawText(ctx, lvl, 14, y + 9);
    drawGlyph(ctx, GLYPH_COIN, 112, y + 9);
    drawText(ctx, String(upgCost(u)), 120, y + 9);
    ctx.globalAlpha = 1;
    if (i === shop.sel) {
      ctx.fillStyle = "#7a953a";
      ctx.fillRect(4, y + 2, 6, 3);
      ctx.fillRect(8, y + 1, 2, 5);
    }
  });
  if (((frame >> 4) & 1) === 0) center("B SALIR", 118);
}

function drawGameOver(ctx) {
  ctx.fillStyle = "rgba(15,56,15,0.85)";
  ctx.fillRect(0, 0, GBC_W, VIEW_H);
  const center = (str, y) => drawTextCentered(ctx, str, y);
  center("GAME OVER", 8);
  const secs = (stats.time * 137) >> 13;
  const mm = String((secs / 60) | 0).padStart(2, "0"), ss = String(secs % 60).padStart(2, "0");
  const rows = [
    ["OLEADA", wave],
    ["BAJAS", stats.kills],
    ["DISPAROS", stats.shots],
    ["TIEMPO", mm + ss],
  ];
  let y = 28;
  for (const [label, value] of rows) {
    drawText(ctx, label, 24, y);
    const v = String(value);
    drawText(ctx, v, 136 - textWidth(v), y);
    y += 10;
  }
  players.forEach((p, i) => {
    if (!p.active) return;
    drawGlyph(ctx, GLYPH_COIN, 24 + i * 56, y + 2);
    drawText(ctx, String(p.coins), 32 + i * 56, y + 2);
    drawGlyph(ctx, PICKUP.crystal, 56 + i * 56 - (i ? 8 : 0), y + 2);
    drawText(ctx, String(p.crystals), 64 + i * 56 - (i ? 8 : 0), y + 2);
  });
  ["CONTINUAR", "NUEVA PARTIDA"].forEach((label, i) => {
    const lx = (GBC_W - textWidth(label)) >> 1;
    const ly = 88 + i * 12;
    drawText(ctx, label, lx, ly);
    if (i === goSel) {
      ctx.fillStyle = "#7a953a";
      ctx.fillRect(lx - 8, ly + 3, 4, 2);
    }
  });
}

function drawGlyph(ctx, id, x, y) {
  if (TEXT_SLOT.has(id)) ctx.drawImage(assets.textBuffer, TEXT_SLOT.get(id) * 8, 0, 8, 8, x, y, 8, 8);
  else {
    const pickup = id === PICKUP.heart || id === PICKUP.coin || id === PICKUP.mana || id === PICKUP.crystal;
    ctx.drawImage(pickup ? assets.pickupTileset : assets.tilesetImage,
      (id % 32) * 8, ((id / 32) | 0) * 8, 8, 8, x, y, 8, 8);
  }
}

let hudBarHalf, hudBarFull, hudBarEndHalf, hudBarLoopHalf, hudBarLoopFull, hudTop;

function initHud() {
  const atlas = assets.biomeTilesets[0];
  const sample = document.createElement("canvas");
  sample.width = sample.height = 8;
  const sampleCtx = sample.getContext("2d");
  sampleCtx.drawImage(atlas, (139 % 32) * 8, (139 >> 5) * 8, 8, 8, 0, 0, 8, 8);
  const pixels = sampleCtx.getImageData(0, 0, 8, 8).data;
  const colors = new Set();
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3]) colors.add((pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2]);
  }
  const brightness = (color) => 299 * (color >> 16) + 587 * ((color >> 8) & 255) + 114 * (color & 255);
  const palette = [...colors].sort((a, b) => brightness(b) - brightness(a));
  if (palette.length !== 4) throw new Error(`La barra de mana debe tener 4 colores; tiene ${palette.length}`);
  const variant = (source, replacements) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 8;
    const c = canvas.getContext("2d");
    c.drawImage(source, 0, 0);
    const data = c.getImageData(0, 0, 8, 8), px = data.data;
    for (let i = 0; i < px.length; i += 4) {
      if (!px[i + 3]) continue;
      const color = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2];
      if (!replacements.has(color)) continue;
      const next = replacements.get(color);
      px[i] = next >> 16; px[i + 1] = (next >> 8) & 255; px[i + 2] = next & 255;
    }
    c.putImageData(data, 0, 0);
    return canvas;
  };
  const half = new Map([[palette[1], palette[2]]]);
  const full = new Map([[palette[1], palette[0]]]);
  hudBarHalf = variant(sample, half);
  hudBarFull = variant(sample, full);
  hudBarEndHalf = variant(sample, new Map([[palette[0], palette[2]], [palette[1], palette[0]]]));
  const loop = document.createElement("canvas");
  loop.width = loop.height = 8;
  loop.getContext("2d").drawImage(atlas, (141 % 32) * 8, (141 >> 5) * 8, 8, 8, 0, 0, 8, 8);
  hudBarLoopHalf = variant(loop, half);
  hudBarLoopFull = variant(loop, full);
  hudTop = document.createElement("canvas");
  hudTop.width = hudTop.height = 8;
  const topCtx = hudTop.getContext("2d");
  for (let x = 0; x < 8; x++)
    topCtx.drawImage(atlas, (142 % 32) * 8 + 7, (142 >> 5) * 8, 1, 8, x, 0, 1, 8);
}

function drawHudImage(ctx, image, sx, sy, x, y, attr = 0) {
  if (!attr) { ctx.drawImage(image, sx, sy, 8, 8, x, y, 8, 8); return; }
  ctx.save();
  ctx.translate(x + 4, y + 4);
  ctx.scale(attr & 0x20 ? -1 : 1, attr & 0x40 ? -1 : 1);
  ctx.drawImage(image, sx, sy, 8, 8, -4, -4, 8, 8);
  ctx.restore();
}

function drawHudTile(ctx, id, x, y, attr = 0) {
  drawHudImage(ctx, assets.biomeTilesets[0], (id % 32) * 8, (id >> 5) * 8, x, y, attr);
}

function drawHudNumber(ctx, value, x, y, width) {
  const text = String(value);
  const scale = Math.min(1, width / (text.length * 8));
  ctx.save();
  ctx.translate(x + width - text.length * 8 * scale, y);
  ctx.scale(scale, 1);
  for (let i = 0; i < text.length; i++) {
    const d = Number(text[i]);
    drawHudTile(ctx, GLYPH_DIGIT0 + (d === 0 ? 10 : d), i * 8, 0);
  }
  ctx.restore();
}

function drawHud(ctx) {
  const top = VIEW_H;
  ctx.fillStyle = "#0f380f";
  ctx.fillRect(0, top, GBC_W, HUD_H);
  for (let x = 1; x < 19; x++) {
    drawHudImage(ctx, hudTop, 0, 0, x * 8, top);
    drawHudTile(ctx, 149, x * 8, top + 16);
  }
  drawHudTile(ctx, 142, 0, top);
  drawHudTile(ctx, 142, 152, top, 0x20);
  drawHudTile(ctx, 145, 0, top + 8);
  drawHudTile(ctx, 145, 152, top + 8, 0x20);
  drawHudTile(ctx, 148, 0, top + 16);
  drawHudTile(ctx, 148, 152, top + 16, 0x20);
  for (const x of [3, 11]) {
    drawHudTile(ctx, 144, x * 8, top);
    drawHudTile(ctx, 147, x * 8, top + 8);
    drawHudTile(ctx, 150, x * 8, top + 16);
  }
  for (const [x, ids] of [[1, [80, 81]], [4, [103, 104, 105]], [12, [119, 120]], [16, [125, 126, 127]]])
    ids.forEach((id, i) => drawHudTile(ctx, id, (x + i) * 8, top));

  const active = players.filter((p) => p.active);
  if (!active.length) return;
  const p = active[Math.floor(frame / 180) % active.length];
  drawGlyph(ctx, PICKUP.heart, 8, top + 8);
  drawHudNumber(ctx, p.hp, 16, top + 8, 8);
  drawGlyph(ctx, PICKUP.mana, 32, top + 8);
  drawHudNumber(ctx, p.coins, 96, top + 8, 16);
  drawGlyph(ctx, PICKUP.coin, 112, top + 8);
  drawHudNumber(ctx, p.crystals, 128, top + 8, 16);
  drawGlyph(ctx, PICKUP.crystal, 144, top + 8);
  if (active.length > 1) drawHudNumber(ctx, p.id + 1, 120, top + 8, 8);

  const halves = Math.floor(Math.max(0, Math.min(CFG.specialCharge, p.mana)) * 12 / CFG.specialCharge);
  for (let i = 0; i < 6; i++) {
    const fill = Math.max(0, Math.min(2, halves - i * 2));
    const x = (5 + i) * 8, end = i === 5;
    if (!fill) drawHudTile(ctx, i === 0 || end ? 138 : 140, x, top + 8, end ? 0x60 : 0);
    else drawHudImage(ctx, i === 0 || end
      ? (fill === 2 ? hudBarFull : end ? hudBarEndHalf : hudBarHalf)
      : (fill === 2 ? hudBarLoopFull : hudBarLoopHalf),
      0, 0, x, top + 8, end ? 0x60 : 0);
  }
}

function enemySpriteY(e) {
  const offset = e.type === "slime" ? 1 : e.type === "bigSlime" ? 2 : 0;
  return (e.y >> 8) - cam.y - offset;
}

const enemyFrameBottoms = new Map();

function initEnemyFrameBottoms() {
  enemyFrameBottoms.clear();
  for (const type of Object.values(CFG.enemyTypes)) {
    const img = assets[type.sprite];
    if (!img) throw new Error(`Falta la imagen del enemigo ${type.sprite}`);
    const cv = document.createElement("canvas");
    cv.width = img.width;
    cv.height = img.height;
    const ctx = cv.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const pixels = ctx.getImageData(0, 0, cv.width, cv.height).data;
    const size = type.size, bottoms = new Map();
    for (let sy = 0; sy + size <= cv.height; sy += size) {
      for (let sx = 0; sx + size <= cv.width; sx += size) {
        let bottom = -1;
        for (let y = size - 1; y >= 0 && bottom < 0; y--) {
          for (let x = 0; x < size; x++) {
            if (pixels[((sy + y) * cv.width + sx + x) * 4 + 3] !== 0) { bottom = y; break; }
          }
        }
        bottoms.set(`${sx},${sy}`, bottom);
      }
    }
    enemyFrameBottoms.set(`${type.sprite}:${size}`, bottoms);
  }
}

function enemySpriteFrame(e) {
  const frameIndex = e.moving ? ((e.animT / CFG.enemyAnimFrames) | 0) & 1 : 0;
  const sx = e.sheet === "flap" ? (((frame >> 1) + (e.id || 0)) & 1) * 8 : e.dir * e.size;
  const sy = e.sheet === "flap" ? 0 : frameIndex * e.size;
  const bottoms = enemyFrameBottoms.get(`${e.sprite}:${e.size}`);
  const bottom = bottoms && bottoms.get(`${sx},${sy}`);
  if (bottom === undefined) throw new Error(`Fotograma enemigo no valido: ${e.sprite} (${sx}, ${sy})`);
  return { sx, sy, bottom };
}

// ------------------------------------------------------------ Renderizado a color original
function render() {
  const ctx = gbc.ctx;
  ctx.clearRect(0, 0, GBC_W, GBC_H);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, GBC_W, GBC_H);

  if (screen !== "game") {
    const draw = { splash: drawSplash, raiders: drawRoster, sheet: drawSheet, settings: drawSettings, about: drawAbout }[screen] || drawSelect;
    draw(ctx);
    document.getElementById("info").textContent = tr({ splash: "hintSplash", raiders: "hintRaiders", sheet: "hintSheet", settings: "hintSettings", about: "hintAbout" }[screen] || (multiplayer ? "hintSelectMulti" : "hintSelectSingle"));
    return;
  }

  const shakeX = wallShake > 0 ? (wallShake & 1 ? -1 : 1) : 0;
  const firstTileX = Math.max(0, (cam.x - shakeX) >> 3);
  const lastTileX = Math.min(MAP_W - 1, (cam.x + GBC_W - 1 - shakeX) >> 3);
  const firstTileY = Math.max(0, cam.y >> 3);
  const lastTileY = Math.min(MAP_H - 1, (cam.y + VIEW_H - 1) >> 3);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, GBC_W, VIEW_H);
  ctx.clip();
  ctx.translate(shakeX, 0);

  const hitCells = new Set();
  for (const b of luckyBoxes) {
    if (!b.alive || !(b.hit > 0)) continue;
    for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) hitCells.add((b.ty + r) * MAP_W + b.tx + c);
  }
  const flashed = (idx) => hitCells.has(idx) || barrierHit.has(idx) || blasts.has(idx);

  // 1. Capa de fondo (fondoLayer)
  for (let ty = firstTileY; ty <= lastTileY; ty++) {
    for (let tx = firstTileX; tx <= lastTileX; tx++) {
      const idx = ty * MAP_W + tx;
      const hasOffX = tileOffX.has(idx);
      const fs = compSlot.get(idx);
      if (fs !== undefined && !flashed(idx) && !tileOffY.has(idx) && !hasOffX) {
        if (!coinWaiting(idx) || fondoClear(idx)) ctx.drawImage(compCv, fs * 8, 0, 8, 8, tx * 8 - cam.x, ty * 8 - cam.y, 8, 8);
        continue;
      }
      if (FLOOR_COMPOSITE_TILES.has(itemsLayer[idx]) && !coinWaiting(idx)) {
        drawMapTile(ctx, tx, ty, 49, 0);
      } else {
        if (fondoClear(idx)) drawMapTile(ctx, tx, ty, baseFloor(idx), 0);
        drawMapTile(ctx, tx, ty, fondoLayer[idx], fondoAttrs[idx], blasts.has(idx));
      }
    }
  }

  // 2. Capa de items (itemsLayer) con soporte para offset vertical (tileOffY) y horizontal (tileOffX)
  for (let ty = firstTileY; ty <= lastTileY; ty++) {
    for (let tx = firstTileX; tx <= lastTileX; tx++) {
      const idx = ty * MAP_W + tx;
      if (itemsLayer[idx] < 0 || coinWaiting(idx)) continue;
      const hasOffX = tileOffX.has(idx);
      const slot = compSlot.get(idx);
      if (slot !== undefined && !flashed(idx) && !tileOffY.has(idx) && !hasOffX) continue;
      for (const [part, flags] of itemTileParts(itemsLayer[idx], itemsAttrs[idx]))
        drawMapTile(ctx, tx, ty, part, flags, flashed(idx), tileOffY.get(idx) || 0,
          hasOffX ? tileOffX.get(idx) : 0,
          LUCKY_DROPS.includes(itemsLayer[idx]) ? hitImages.pickups : hitCells.has(idx) ? hitImages.luckyTileset : null,
          LUCKY_DROPS.includes(itemsLayer[idx]) ? assets.pickupTileset : null);
    }
  }

  for (const p of players) {
    if (!p.active || p.hp <= 0 || !p.sp) continue;
    const aiming = p.sp.state === "aim";
    if (!aiming && (p.sp.state !== "active" || p.sp.instant)) continue;
    const explosionId = 156 + Math.floor(p.sp.t / CFG.specialExplosionFrameTicks) % 4;
    for (const cell of specialMarkerCells(p.sp)) {
      if (cell.tx >= firstTileX && cell.tx <= lastTileX && cell.ty >= firstTileY && cell.ty <= lastTileY)
        drawSpecialTile(ctx, cell, aiming ? cell.id : explosionId, aiming ? cell.attr : 0,
          flashed(cell.ty * MAP_W + cell.tx), hitCells.has(cell.ty * MAP_W + cell.tx) ? hitImages.luckyTileset : null,
          aiming ? assets.tilesetImage : assets.biomeTilesets[0]);
    }
  }
  for (const effect of specialExplosions) {
    const id = 156 + Math.floor(effect.age / CFG.specialExplosionFrameTicks);
    for (const cell of effect.cells) {
      if (cell.tx >= firstTileX && cell.tx <= lastTileX && cell.ty >= firstTileY && cell.ty <= lastTileY && specialFloor(cell.tx, cell.ty))
        drawSpecialTile(ctx, cell, id, 0, flashed(cell.ty * MAP_W + cell.tx),
          hitCells.has(cell.ty * MAP_W + cell.tx) ? hitImages.luckyTileset : null, assets.biomeTilesets[0]);
    }
  }

  for (const effect of teleportEffects) {
    if (effect.overPlayer) continue;
    const spriteFrame = Math.min(7, effect.age >> 1);
    ctx.drawImage(
      assets.playerImage,
      spriteFrame * 16, 5 * 16, 16, 16,
      effect.x - cam.x, effect.y - cam.y, 16, 16
    );
  }

  for (const p of players) {
    if (!p.active || p.hp <= 0) continue;
    if (p.inv > 0 && !(p.hit > 0) && ((frame >> 2) & 1)) continue;
    const px = (p.x >> 8) - cam.x;
    const py = (p.y >> 8) - cam.y;
    if (p.tp && p.tp.step === 1) continue;
    if (p.tp) ctx.globalAlpha = 0.55;
    const spriteColumn = p.pushAnim ? 8 : p.facing;
    const sheet = p.hit > 0 ? hitImages[p.ch.img] || assets[p.ch.img] : assets[p.ch.img];
    if (p.pushAnim === "left") {
      ctx.save();
      ctx.translate(px + 16, py);
      ctx.scale(-1, 1);
      ctx.drawImage(sheet, spriteColumn * 16, p.row * 16, 16, 16, 0, 0, 16, 16);
      ctx.restore();
    } else {
      ctx.drawImage(sheet, spriteColumn * 16, p.row * 16, 16, 16, px, py, 16, 16);
    }
    if (p.tp) ctx.globalAlpha = 1;
  }

  for (const effect of teleportEffects) {
    if (!effect.overPlayer) continue;
    const spriteFrame = Math.min(7, effect.age >> 1);
    ctx.drawImage(
      assets.playerImage,
      spriteFrame * 16, 5 * 16, 16, 16,
      effect.x - cam.x, effect.y - cam.y, 16, 16
    );
  }

  for (const p of players) {
    if (!p.active || !(p.slash > 0) || !p.slashRect) continue;
    const r = p.slashRect;
    ctx.save();
    ctx.beginPath();
    for (let y = r.y + 2; y < r.y + r.h - 2; y++) for (let x = r.x + 2; x < r.x + r.w - 2; x++) {
      if (attackPathClear(p.slashOrigin.x, p.slashOrigin.y, x, y)) ctx.rect(x - cam.x, y - cam.y, 1, 1);
    }
    ctx.clip();
    ctx.fillStyle = "#fff";
    ctx.fillRect(r.x - cam.x + 2, r.y - cam.y + 2, r.w - 4, r.h - 4);
    ctx.fillStyle = "#7a953a";
    ctx.fillRect(r.x - cam.x + 5, r.y - cam.y + 5, r.w - 10, r.h - 10);
    ctx.restore();
  }

  for (const b of bullets) {
    ctx.fillStyle = "#fff";
    if (b.beam) {
      ctx.fillRect((b.x >> 8) - cam.x - 4, (b.y >> 8) - cam.y - 4, 8, 8);
      ctx.fillStyle = "#0f380f";
      ctx.fillRect((b.x >> 8) - cam.x - 2, (b.y >> 8) - cam.y - 2, 4, 4);
      continue;
    }
    const shot = b.img && assets[b.img];
    if (shot) { // sprite del disparo con 3 frames (0: vert, 1: 45º, 2: horiz) y mirror
      const frames = shot.width >= 12 ? 3 : 1;
      const fw = (shot.width / frames) | 0;
      const fh = shot.height;
      const fIdx = frames === 3 ? (b.bulletFrame ?? 2) : 0;
      const sx = fIdx * fw;
      const dx = (b.x >> 8) - cam.x - (fw >> 1);
      const dy = (b.y >> 8) - cam.y - (fh >> 1);
      if (b.mirror) {
        ctx.save();
        ctx.translate(dx + fw, dy);
        ctx.scale(-1, 1);
        ctx.drawImage(shot, sx, 0, fw, fh, 0, 0, fw, fh);
        ctx.restore();
      } else {
        ctx.drawImage(shot, sx, 0, fw, fh, dx, dy, fw, fh);
      }
      continue;
    }
    if (b.direct) { ctx.fillRect((b.x >> 8) - cam.x - 1, (b.y >> 8) - cam.y - 1, 2, 2); continue; }
    ctx.fillRect((b.x >> 8) - cam.x - 2, (b.y >> 8) - cam.y - 2, 4, 4);
  }

  if (selFrame !== frame) {
    selFrame = frame;
    const live = players.filter((p) => p.active && p.hp > 0);
    const cand = [];
    for (const e of enemies) {
      const px = (e.x >> 8) - cam.x + shakeX, py = enemySpriteY(e);
      e.vis = false;
      if (px + e.size <= 0 || px >= GBC_W || py + e.size <= 0 || py >= VIEW_H) { e.hid = 0; continue; }
      let d = Infinity;
      for (const p of live) d = Math.min(d, ((p.x >> 8) - (e.x >> 8)) ** 2 + ((p.y >> 8) - (e.y >> 8)) ** 2);
      e.dist = d;
      cand.push(e);
    }
    const rank = (e) => (e.hid >= 2 ? 0 : e.hid === 1 ? 1 : 2);
    cand.sort((a, b) => rank(a) - rank(b) || a.dist - b.dist);
    const lineCount = new Map();
    let spriteCount = 0;
    for (const e of cand) {
      const py = enemySpriteY(e);
      const cells = e.size >> 3;
      let ok = spriteCount + cells * cells <= CFG.maxSprites;
      for (let r = 0; r < cells && ok; r++) ok = (lineCount.get((py >> 3) + r) || 0) + cells <= CFG.maxSpritesPerLine;
      if (ok) {
        spriteCount += cells * cells;
        for (let r = 0; r < cells; r++) lineCount.set((py >> 3) + r, (lineCount.get((py >> 3) + r) || 0) + cells);
        e.vis = true;
        e.hid = 0;
      } else {
        e.hid = (e.hid || 0) + 1;
      }
    }
  }
  const visibleEnemies = [];
  for (const e of enemies) {
    if (!e.vis) continue;
    const sprite = enemySpriteFrame(e);
    if (sprite.bottom < 0) continue;
    visibleEnemies.push({ e, sprite, y: enemySpriteY(e) });
  }
  visibleEnemies.sort((a, b) => a.y + a.sprite.bottom - b.y - b.sprite.bottom);
  for (const { e, sprite, y } of visibleEnemies) {
    const img = assets[e.sprite];
    ctx.drawImage(e.hit > 0 ? hitImages[e.sprite] || img : img, sprite.sx, sprite.sy, e.size, e.size,
      (e.x >> 8) - cam.x, y, e.size, e.size);
  }
  for (const effect of enemyDeathEffects) {
    const offset = (effect.size - 8) >> 1;
    ctx.drawImage(assets.enemyDeathImage, (effect.x >> 8) - cam.x + offset, enemySpriteY(effect) + offset);
  }
  if ((frame >> 3) & 1) {
    for (const p of players) {
      if (p.active && p.hp > 0 && p.reloadT > 0)
        ctx.drawImage(assets.reloadImage, (p.x >> 8) - cam.x + 4, (p.y >> 8) - cam.y - 8);
    }
  }
  ctx.restore();
  drawHud(ctx);
  if (gameOver) drawGameOver(ctx);
  if (shop) drawShop(ctx);
  if (paused && !gameOver && !shop) {
    ctx.fillStyle = "rgba(15,56,15,0.85)";
    ctx.fillRect(0, 0, GBC_W, VIEW_H);
    drawTextCentered(ctx, "PAUSA", 28);
    ["CONTINUAR", "REINICIAR", "SALIR"].forEach((label, i) => {
      const lx = (GBC_W - textWidth(label)) >> 1;
      const ly = 54 + i * 14;
      drawText(ctx, label, lx, ly);
      if (i === (window.pauseSel || 0)) {
        ctx.fillStyle = "#7a953a";
        ctx.fillRect(lx - 8, ly + 3, 4, 2);
      }
    });
  }

  const status = players.map((p) => p.active ? `J${p.id + 1} HP ${p.hp} $ ${p.coins}` : `J${p.id + 1} -`).join("   ");
  document.getElementById("info").textContent = gameOver ? "GAME OVER - Arriba/Abajo elegir, Enter o disparo confirmar" :
    `${paused ? "PAUSA · " : ""}${status}   Oleada ${wave}   Enemigos ${enemies.length}`;
}