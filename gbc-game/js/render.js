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
function drawMapTile(ctx, tx, ty, tileId, attr, hit = false, dy = 0) {
  if (tileId < 0) return;
  const screenX = tx * 8 - cam.x;
  const screenY = ty * 8 - cam.y + dy;
  const sourceX = (tileId % 32) * 8;
  const sourceY = (tileId >> 5) * 8;
  const flags = attr || 0;
  ctx.save();
  ctx.translate(screenX + 4, screenY + 4);
 if (flags & 0x20) ctx.scale(-1, 1);
  if (flags & 0x40) ctx.scale(1, -1);
  ctx.drawImage(hit && hitImages.tileset ? hitImages.tileset : assets.tilesetImage, sourceX, sourceY, 8, 8, -4, -4, 8, 8);
  ctx.restore();
}

// ------------------------------------------------------------ HUD (2 tiles de alto, parte inferior)
const GLYPH_COIN = 146, GLYPH_HEART = 147, GLYPH_DIGIT0 = 127; // digitos: 128-136 = 1-9, 137 = 0

// Texto: los glifos de la fuente 8x8 (ancho proporcional) se componen en 32 tiles libres del tileset
// (ids 74-92 y 106-118, transparentes en el PNG) y despues se pintan como tiles.
const FONT_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,";
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
  f.height = assets.fontImage.height;
  const fc = f.getContext("2d");
  fc.drawImage(assets.fontImage, 0, 0);
  const data = fc.getImageData(0, 0, f.width, f.height).data;
  fc.globalCompositeOperation = "source-in";
  fc.fillStyle = "#7a953a";
  fc.fillRect(0, 0, f.width, f.height);
  assets.fontTinted = f;
  for (let n = 0; n < FONT_CHARS.length; n++) {
    const cx = (n % 8) * 8, cy = (n >> 3) * 8;
    let x0 = 8, x1 = -1;
    for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) {
      if (data[((cy + y) * f.width + cx + x) * 4 + 3]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
    }
    fontGlyphs[FONT_CHARS[n]] = x1 < 0 ? { sx: cx, w: 0 } : { sx: cx + x0, w: x1 - x0 + 1 };
  }
}

const textNorm = (str) => String(str).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
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
    if (g && g.w) tileBufCtx.drawImage(assets.fontTinted, g.sx, (FONT_CHARS.indexOf(ch) >> 3) * 8, g.w, 8, pen, 0, g.w, 8);
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
    drawGem(ctx, 56 + i * 56 - (i ? 8 : 0), y + 2);
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
  else ctx.drawImage(assets.tilesetImage, (id % 32) * 8, ((id / 32) | 0) * 8, 8, 8, x, y, 8, 8);
}

function drawNumber(ctx, value, x, y) {
  for (const ch of String(value)) {
    const d = Number(ch);
    drawGlyph(ctx, GLYPH_DIGIT0 + (d === 0 ? 10 : d), x, y);
    x += 8;
  }
}

function drawGem(ctx, x, y) {
  const rows = ["..1111..", ".122221.", "12233221", "12233221", ".122221.", "..1221..", "...11...", "........"];
  const cols = { 1: "#0f380f", 2: "#55742a", 3: "#7a953a" };
  rows.forEach((row, ry) => {
    for (let rx = 0; rx < 8; rx++) {
      const ch = row[rx];
      if (ch === ".") continue;
      ctx.fillStyle = ch === "1" ? "#7a953a" : cols[ch];
      ctx.fillRect(x + rx, y + ry, 1, 1);
    }
  });
}

function drawHud(ctx) {
  const top = VIEW_H;
  ctx.fillStyle = "#0f380f";
  ctx.fillRect(0, top, GBC_W, HUD_H);
  for (const p of players) {
    if (!p.active) continue;
    const x0 = p.id * 80;
    for (let h = 0; h < Math.min(p.hp, 7); h++) drawGlyph(ctx, GLYPH_HEART, x0 + h * 8, top);
    drawGlyph(ctx, GLYPH_COIN, x0 + 56, top);
    drawNumber(ctx, p.coins, x0 + 64, top);
    drawGem(ctx, x0 + 56, top + 8);
    drawNumber(ctx, p.crystals, x0 + 64, top + 8);
    if (p.reloadT > 0 && ((frame >> 3) & 1)) {
      drawText(ctx, "RELOAD", x0, top + 8);
    } else {
      const full = p.mana >= CFG.specialCharge;
      ctx.fillStyle = "#55742a";
      ctx.fillRect(x0, top + 10, 48, 4);
      ctx.fillStyle = "#0f380f";
      ctx.fillRect(x0 + 1, top + 11, 46, 2);
      ctx.fillStyle = full && ((frame >> 3) & 1) ? "#7a953a" : "#55742a";
      ctx.fillRect(x0 + 1, top + 11, Math.min(46, (p.mana * 5) >> 8), 2);
    }
  }
}

// ------------------------------------------------------------ Renderizado a color original
function render() {
  const ctx = gbc.ctx;
  ctx.clearRect(0, 0, GBC_W, GBC_H);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, GBC_W, GBC_H);

  if (screen !== "game") {
    const draw = { splash: drawSplash, raiders: drawRoster, sheet: drawSheet, settings: drawSettings }[screen] || drawSelect;
    draw(ctx);
    document.getElementById("info").textContent = tr({ splash: "hintSplash", raiders: "hintRaiders", sheet: "hintSheet", settings: "hintSettings" }[screen] || "hintSelect");
    return;
  }

  const firstTileX = Math.max(0, cam.x >> 3);
  const lastTileX = Math.min(MAP_W - 1, (cam.x + GBC_W - 1) >> 3);
  const firstTileY = Math.max(0, cam.y >> 3);
  const lastTileY = Math.min(MAP_H - 1, (cam.y + VIEW_H - 1) >> 3);

  const spCells = new Set();
  for (const p of players) {
    if (!p.active || !p.sp) continue;
    if (p.sp.state === "aim" && !((frame >> 3) & 1)) continue;
    for (let r = 0; r < p.sp.h; r++) for (let c = 0; c < p.sp.w; c++) spCells.add((p.sp.ty + r) * MAP_W + p.sp.tx + c);
  }

  const hitCells = new Set();
  for (const b of manaBoxes) {
    if (!b.alive || !(b.hit > 0)) continue;
    for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) hitCells.add((b.ty + r) * MAP_W + b.tx + c);
  }
  const flashed = (idx) => hitCells.has(idx) || barrierHit.has(idx) || blasts.has(idx) || spCells.has(idx);

  for (let ty = firstTileY; ty <= lastTileY; ty++) {
    for (let tx = firstTileX; tx <= lastTileX; tx++) {
      const idx = ty * MAP_W + tx;
      const fs = compSlot.get(idx);
      if (fs !== undefined && !flashed(idx) && !tileOffY.has(idx)) {
        if (!coinWaiting(idx) || fondoClear(idx)) ctx.drawImage(compCv, fs * 8, 0, 8, 8, tx * 8 - cam.x, ty * 8 - cam.y, 8, 8);
        continue;
      }
      drawMapTile(ctx, tx, ty, fondoLayer[idx], fondoAttrs[idx], blasts.has(idx) || spCells.has(idx));
    }
  }

  for (let ty = firstTileY; ty <= lastTileY; ty++) {
    for (let tx = firstTileX; tx <= lastTileX; tx++) {
      const idx = ty * MAP_W + tx;
      if (itemsLayer[idx] < 0 || coinWaiting(idx)) continue;
      const slot = compSlot.get(idx);
      if (slot !== undefined && !flashed(idx) && !tileOffY.has(idx)) continue;
      drawMapTile(ctx, tx, ty, itemsLayer[idx], itemsAttrs[idx], flashed(idx), tileOffY.get(idx) || 0);
    }
  }

  for (const effect of teleportEffects) {
    const spriteFrame = Math.min(7, effect.age >> 1);
    ctx.drawImage(
      assets.teleportImage,
      spriteFrame * 16, 0, 16, 16,
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

  for (const p of players) {
    if (!p.active || !(p.slash > 0) || !p.slashRect) continue;
    const r = p.slashRect;
    ctx.fillStyle = "#fff";
    ctx.fillRect(r.x - cam.x + 2, r.y - cam.y + 2, r.w - 4, r.h - 4);
    ctx.fillStyle = "#7a953a";
    ctx.fillRect(r.x - cam.x + 5, r.y - cam.y + 5, r.w - 10, r.h - 10);
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
    if (shot) { // sprite del disparo, centrado en la bala
      ctx.drawImage(shot, (b.x >> 8) - cam.x - (shot.width >> 1), (b.y >> 8) - cam.y - (shot.height >> 1));
      continue;
    }
    if (b.direct) { ctx.fillRect((b.x >> 8) - cam.x - 1, (b.y >> 8) - cam.y - 1, 2, 2); continue; }
    ctx.fillRect((b.x >> 8) - cam.x - 2, (b.y >> 8) - cam.y - 2, 4, 4);
  }

  // Limite de sprites: un sprite oculto un frame se muestra en el siguiente; si hay demasiados,
  // los mas lejanos al jugador pueden quedar ocultos hasta 2 frames seguidos.
  if (selFrame !== frame) {
    selFrame = frame;
    const live = players.filter((p) => p.active && p.hp > 0);
    const cand = [];
    for (const e of enemies) {
      const px = (e.x >> 8) - cam.x, py = (e.y >> 8) - cam.y;
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
      const py = (e.y >> 8) - cam.y;
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
  for (const e of enemies) {
    if (!e.vis) continue;
    const px = (e.x >> 8) - cam.x, py = (e.y >> 8) - cam.y;
    const frameIndex = e.moving ? ((e.animT / CFG.enemyAnimFrames) | 0) & 1 : 0;
    const img = assets[e.sprite];
    const src = e.type === "bee" ? img && [(((frame >> 1) + (e.id || 0)) & 1) * 8, 0] : [e.dir * e.size, frameIndex * e.size];
    const sw = e.type === "bee" ? 8 : e.size;
    ctx.drawImage(e.hit > 0 ? hitImages[e.sprite] || img : img, src[0], src[1], sw, sw, px, py, e.size, e.size);
  }
  drawHud(ctx);
  if (gameOver) drawGameOver(ctx);
  if (shop) drawShop(ctx);

  const status = players.map((p) => p.active ? `J${p.id + 1} HP ${p.hp} $ ${p.coins}` : `J${p.id + 1} -`).join("   ");
  document.getElementById("info").textContent = gameOver ? "GAME OVER - Arriba/Abajo elegir, Enter o disparo confirmar" :
    `${paused ? "PAUSA · " : ""}${status}   Oleada ${wave}   Enemigos ${enemies.length}`;
}

