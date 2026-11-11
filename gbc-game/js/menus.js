"use strict";
/* Menus: splash, seleccion de personaje, raiders y ajustes. */

// ------------------------------------------------------------ Pantallas: splash y seleccion de personaje
let screen = "splash";
let menuSel = 0, rosterSel = 0, setSel = 0;
let multiplayer = false, aboutScroll = 0;
const pick = { cur: [0, 1], ready: [false, false], joined: [true, false] };
const SPLASH_OPTIONS = ["Single Player", "Multiplayer", "Raiders", "About"];
const ABOUT_TEXT = "Raiders Rise ©2026 Penguin Armada S.L. Raiders Rise and the Raiders Rise logo are trademarks and/or registered trademarks of Penguin Armada S.L. Penguin Armada and the Penguin Armada logo are trademarks and/or registered trademarks of Penguin Armada S.L.";
const ABOUT_QR_SIZE = 90;
const STAT_BARS = [
  { label: "spd", key: "spd" },
  { label: "hp", key: "hp" },
  { label: "dmg", key: "dmg" },
];

const TXT = {
  es: { choose: "Elige personaje", pressA: "A elegir", ready: "Listo", spd: "Vel", hp: "Vida", dmg: "Dano", weapon: "Arma", special: "Especial",
    raiders: "Raiders", settings: "Ajustes", language: "Idioma", langName: "Espanol", sound: "Sonido", music: "Musica", sfx: "Efectos", back: "Volver",
    hintSplash: "Arriba/Abajo elegir, F aceptar", hintSelectSingle: "Izq/Der elegir, F confirmar, G cancelar", hintSelectMulti: "Izq/Der elegir, F confirmar, G cancelar; J2: flechas y ,",
    hintAbout: "Arriba/Abajo desplazar, G volver",
    hintRaiders: "Izq/Der elegir, F ver ficha, G volver", hintSheet: "Izq/Der cambiar personaje, G volver", hintSettings: "Arriba/Abajo elegir, Izq/Der cambiar, G volver" },
  en: { choose: "Choose character", pressA: "A choose", ready: "Ready", spd: "Speed", hp: "HP", dmg: "Damage", weapon: "Weapon", special: "Special",
    raiders: "Raiders", settings: "Settings", language: "Language", langName: "English", sound: "Sound", music: "Music", sfx: "Effects", back: "Back",
    hintSplash: "Up/Down choose, F accept", hintSelectSingle: "Left/Right choose, F confirm, G cancel", hintSelectMulti: "Left/Right choose, F confirm, G cancel; P2: arrows and ,",
    hintAbout: "Up/Down scroll, G back",
    hintRaiders: "Left/Right choose, F details, G back", hintSheet: "Left/Right change character, G back", hintSettings: "Up/Down choose, Left/Right change, G back" },
};
const tr = (k) => TXT[settings.lang ? "en" : "es"][k];
const charName = (i) => CHARS[i].name[0] + CHARS[i].name.slice(1).toLowerCase();
const ROSTER_PORTRAITS = [
  { x: 11, y: 9, profile: true }, { x: 68, y: 25 }, { x: 108, y: 25 },
  { x: 27, y: 73, name: "Baba" }, { x: 67, y: 73, name: "Maya" }, { x: 107, y: 73, name: "Korin" },
];

function openSelect() {
  screen = "select";
  pick.ready = [false, false];
  pick.joined = [true, multiplayer];
  pick.cur = [chars[0], chars[1]];
}
function openRaiders() { screen = "raiders"; }
function openSettings() { screen = "settings"; setSel = 0; }
function openAbout() { screen = "about"; aboutScroll = 0; }

function updateMenu() {
  rand16(); // la semilla depende del momento en que el jugador pulsa
  const pr0 = input.pressed[0], pr1 = input.pressed[1];
  const any = pr0 | pr1;
  const ok = any & (BTN.A | BTN.START), back = any & BTN.B;
  const dx = (any & BTN.RIGHT ? 1 : 0) - (any & BTN.LEFT ? 1 : 0);
  const dy = (any & BTN.DOWN ? 1 : 0) - (any & BTN.UP ? 1 : 0);
  if (screen === "splash") {
    if (dy) { menuSel = (menuSel + SPLASH_OPTIONS.length + dy) % SPLASH_OPTIONS.length; sfx("hit"); }
    if (ok) {
      sfx("coin");
      if (menuSel < 2) { multiplayer = menuSel === 1; openSelect(); }
      else if (menuSel === 2) openRaiders();
      else openAbout();
    }
    return;
  }
  if (screen === "about") {
    const held = input.held[0] | input.held[1];
    const scrollDir = (held & BTN.DOWN ? 1 : 0) - (held & BTN.UP ? 1 : 0);
    aboutScroll = Math.max(0, Math.min(aboutScrollMax(), aboutScroll + scrollDir));
    if (back) screen = "splash";
    return;
  }
  if (screen === "raiders" || screen === "sheet") {
    if (dx) { rosterSel = (rosterSel + CHARS.length + dx) % CHARS.length; sfx("hit"); }
    if (screen === "raiders" && ok) { sfx("coin"); screen = "sheet"; }
    else if (back) screen = screen === "sheet" ? "raiders" : "splash";
    return;
  }
  if (screen === "settings") {
    const rows = 5;
    if (dy) { setSel = (setSel + rows + dy) % rows; sfx("hit"); }
    const key = ["lang", "master", "music", "sfx"][setSel];
    if (key && dx) {
      settings[key] = key === "lang" ? settings.lang ^ 1 : Math.min(5, Math.max(0, settings[key] + dx));
      saveSettings();
      sfx("coin");
    }
    if (back || (ok && setSel === rows - 1)) screen = "splash";
    return;
  }
  const pressedBy = [pr0, pr1];
  for (let i = 0; i < 2; i++) {
    if (i === 1 && !multiplayer) continue;
    const pr = pressedBy[i];
    if (!pick.ready[i]) {
      const n = CHARS.length;
      if (pr & BTN.LEFT) { pick.cur[i] = (pick.cur[i] + n - 1) % n; sfx("hit"); }
      if (pr & BTN.RIGHT) { pick.cur[i] = (pick.cur[i] + 1) % n; sfx("hit"); }
      if (pr & (BTN.A | BTN.START)) { pick.ready[i] = true; sfx("coin"); }
      else if (i === 0 && (pr & BTN.B)) screen = "splash";
    } else if (pr & BTN.B) {
      pick.ready[i] = false;
    }
  }
  if (pick.ready[0] && (!pick.joined[1] || pick.ready[1])) {
    chars[0] = pick.cur[0];
    chars[1] = pick.joined[1] ? pick.cur[1] : (pick.cur[0] + 1) % CHARS.length;
    const p2 = pick.joined[1];
    screen = "game";
    resetGame();
    players[1].active = p2;
  }
}

function drawSplash(ctx) {
  const m = assets.splashMap;
  for (let i = 0; i < m.tiles.length; i++) {
    const t = m.tiles[i];
    ctx.drawImage(assets.splashTiles, (t % m.cols) * 8, ((t / m.cols) | 0) * 8, 8, 8, (i % m.w) * 8, ((i / m.w) | 0) * 8, 8, 8);
  }
  SPLASH_OPTIONS.forEach((label, i) => {
    const cx = GBC_W >> 1, y = 100 + i * 9;
    const left = cx - (textWidth(label) >> 1), right = left + textWidth(label);
    const sel = i === menuSel;
    if (sel) {
      ctx.fillStyle = "#2a4e19";
      ctx.fillRect(left - 3, y, right - left + 6, 8);
    }
    ctx.globalAlpha = sel ? 1 : 0.7;
    drawTextCentered(ctx, label, y, cx);
    ctx.globalAlpha = 1;
    if (sel) {
      const offset = Math.floor(frame / 30) % 2;
      ctx.fillStyle = "#7a953a";
      ctx.fillRect(left - 8 - offset, y + 1, 1, 5);
      ctx.fillRect(left - 7 - offset, y + 2, 1, 3);
      ctx.fillRect(left - 6 - offset, y + 3, 1, 1);
      ctx.fillRect(right + 7 + offset, y + 1, 1, 5);
      ctx.fillRect(right + 6 + offset, y + 2, 1, 3);
      ctx.fillRect(right + 5 + offset, y + 3, 1, 1);
    }
  });
}

function initAboutQr() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = ABOUT_QR_SIZE;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(assets.qrImage, 0, 0, ABOUT_QR_SIZE, ABOUT_QR_SIZE);
  const data = ctx.getImageData(0, 0, ABOUT_QR_SIZE, ABOUT_QR_SIZE);
  for (let i = 0; i < data.data.length; i += 4) {
    const dark = data.data[i] + data.data[i + 1] + data.data[i + 2] < 3 * 128;
    const color = dark ? [15, 56, 15] : [122, 149, 58];
    data.data[i] = color[0];
    data.data[i + 1] = color[1];
    data.data[i + 2] = color[2];
  }
  ctx.putImageData(data, 0, 0);
  assets.aboutQrImage = canvas;
}

function aboutQrY(lines) { return 46 + lines.length * 8; }
function aboutScrollMax() {
  return Math.max(0, aboutQrY(wrapText(ABOUT_TEXT, 144)) + ABOUT_QR_SIZE + 8 - GBC_H);
}

function drawAbout(ctx) {
  drawBackdrop(ctx);
  const lines = wrapText(ABOUT_TEXT, 144);
  const qrY = aboutQrY(lines);
  drawTextCentered(ctx, "About", 6 - aboutScroll);
  lines.forEach((line, i) => drawText(ctx, line, 8, 20 + i * 8 - aboutScroll));
  drawTextCentered(ctx, "A retro action game", qrY - 18 - aboutScroll);
  drawTextCentered(ctx, "Play on mobile", qrY - 9 - aboutScroll);
  ctx.drawImage(assets.aboutQrImage, 35, qrY - aboutScroll);
}

function drawBackdrop(ctx) {
  ctx.fillStyle = "#0f380f";
  ctx.fillRect(0, 0, GBC_W, GBC_H);
}

function drawBars(ctx, x, y, n, total = 5, w = 7, gap = 1) {
  for (let k = 0; k < total; k++) {
    ctx.fillStyle = k < n ? "#7a953a" : "#2a4e19";
    ctx.fillRect(x + k * (w + gap), y, w, 4);
  }
}

function drawRaiderPortrait(ctx, i, x, y) {
  const portrait = ROSTER_PORTRAITS[i];
  ctx.drawImage(portrait.profile ? assets.profileImage : assets.selectionImage, portrait.x, portrait.y, 30, 30, x, y, 30, 30);
}

function drawRosterBackground(ctx) {
  for (let x = 0; x < GBC_W; x += 8)
    ctx.drawImage(assets.selectionImage, 0, 0, 8, GBC_H, x, 0, 8, GBC_H);
  ctx.drawImage(assets.selectionImage, 0, 0, 160, 20, 0, 0, 160, 20);
}

function drawRosterCard(ctx, i, borderColor) {
  const x = 24 + (i % 3) * 40, y = 24 + Math.floor(i / 3) * 48;
  const locked = i >= CHARS.length;
  ctx.fillStyle = "#09270f";
  if (borderColor) {
    ctx.fillRect(x + 7, y - 1, 34, 1);
    for (let row = 0; row < 40; row++) {
      const left = x + 8 - Math.floor(row / 5);
      ctx.fillRect(left - 1, y + row, 34, 1);
    }
    ctx.fillRect(x, y + 40, 34, 1);
  }
  ctx.beginPath();
  for (let row = 0; row < 40; row++) {
    const left = x + 8 - Math.floor(row / 5);
    ctx.fillRect(left, y + row, 32, 1);
    ctx.rect(left, y + row, 32, 1);
  }
  ctx.save();
  ctx.clip();
  drawRaiderPortrait(ctx, i, x + 4, y + 1);
  ctx.restore();
  ctx.globalAlpha = locked ? 0.6 : 1;
  drawTextCentered(ctx, locked ? ROSTER_PORTRAITS[i].name : charName(i), y + 31, x + 16);
  ctx.globalAlpha = 1;
  if (locked) {
    ctx.fillStyle = "#0f380f";
    ctx.fillRect(x + 24, y + 23, 8, 8);
    ctx.fillStyle = "#7a953a";
    ctx.fillRect(x + 26, y + 24, 4, 1);
    ctx.fillRect(x + 25, y + 25, 1, 2);
    ctx.fillRect(x + 30, y + 25, 1, 2);
    ctx.fillRect(x + 25, y + 27, 6, 4);
  }
  if (borderColor) {
    ctx.fillStyle = borderColor;
    for (let row = 0; row < 40; row++) {
      const left = x + 8 - Math.floor(row / 5);
      if (row === 0 || row === 39) ctx.fillRect(left, y + row, 32, 1);
      else {
        ctx.fillRect(left, y + row, 1, 1);
        ctx.fillRect(left + 31, y + row, 1, 1);
      }
    }
  }
}

function drawRoster(ctx) {
  drawRosterBackground(ctx);
  ROSTER_PORTRAITS.forEach((portrait, i) => drawRosterCard(ctx, i, i === rosterSel ? "#7a953a" : null));
}

function drawSheet(ctx) {
  ctx.drawImage(assets.profileImage, 0, 0);
  ctx.fillStyle = "#2a4e19";
  ctx.fillRect(28, 0, 124, 144);
  ctx.fillRect(8, 8, 39, 31);
  const i = rosterSel, ui = CHARS[i].ui, info = CHARS[i].info[settings.lang ? "en" : "es"];
  drawRaiderPortrait(ctx, i, 11, 8);
  drawText(ctx, charName(i), 55, 8);
  STAT_BARS.forEach((s, n) => {
    const y = 18 + n * 9;
    drawText(ctx, tr(s.label), 55, y);
    drawBars(ctx, 91, y + 2, ui[s.key], 5, 6, 1);
  });
  let y = 48;
  [["weapon", info.weapon], ["special", info.special]].forEach(([k, text]) => {
    drawText(ctx, tr(k), 32, y);
    ctx.fillStyle = "#55742a";
    ctx.fillRect(32, y + 8, 112, 1);
    wrapText(text, 112).forEach((line, n) => drawText(ctx, line, 32, y + 11 + n * 8));
    y += 46;
  });
}

function drawSettings(ctx) {
  drawBackdrop(ctx);
  drawTextCentered(ctx, tr("settings"), 8);
  const rows = [
    [tr("language")],
    [tr("sound"), 0, "master"],
    [tr("music"), 0, "music"],
    [tr("sfx"), 0, "sfx"],
    [tr("back")],
  ];
  rows.forEach(([label, , key], n) => {
    const y = 30 + n * 16;
    if (n === setSel) {
      ctx.fillStyle = "#7a953a";
      ctx.fillRect(10, y + 2, 4, 3);
      ctx.fillRect(14, y + 3, 1, 1);
    }
    ctx.globalAlpha = n === setSel ? 1 : 0.6;
    drawText(ctx, label, 20, y);
    if (n === 0) drawText(ctx, tr("langName"), 96, y);
    if (key) drawBars(ctx, 96, y + 2, settings[key], 5, 8, 2);
    ctx.globalAlpha = 1;
  });
}

function drawSelect(ctx) {
  drawRosterBackground(ctx);
  const center = (str, y) => drawTextCentered(ctx, str, y);
  ROSTER_PORTRAITS.forEach((portrait, i) => {
    const bx = 24 + (i % 3) * 40, by = 24 + Math.floor(i / 3) * 48;
    const selected = pick.joined.some((joined, pi) => joined && pick.cur[pi] === i);
    const ready = pick.joined.some((joined, pi) => joined && pick.cur[pi] === i && pick.ready[pi]);
    drawRosterCard(ctx, i, selected ? (ready ? "#7a953a" : "#55742a") : null);
    for (let pi = 0; multiplayer && pi < 2; pi++) {
      if (!pick.joined[pi] || pick.cur[pi] !== i) continue;
      const mx = bx + (pi ? 23 : -3);
      const my = by - 3;
      const on = pick.ready[pi] || ((frame >> 4) & 1);
      ctx.fillStyle = on ? "#7a953a" : "#55742a";
      ctx.fillRect(mx, my, 10, 7);
      ctx.fillStyle = "#0f380f";
      drawTextTiny(ctx, String(pi + 1), mx + 3, my + 1);
    }
  });
  if (multiplayer) {
    drawTextCentered(ctx, `J1 ${tr(pick.ready[0] ? "ready" : "pressA")}`, 118, 40);
    drawTextCentered(ctx, `J2 ${tr(pick.ready[1] ? "ready" : "pressA")}`, 118, 120);
  } else {
    center(pick.ready[0] ? tr("ready") : tr("pressA"), 118);
  }
}

// Digito diminuto 3x5 para las etiquetas de jugador.
function drawTextTiny(ctx, str, x, y) {
  const glyphs = { 1: ["010", "110", "010", "010", "111"], 2: ["110", "001", "010", "100", "111"] };
  const g = glyphs[str];
  if (!g) return;
  g.forEach((row, ry) => { for (let rx = 0; rx < 3; rx++) if (row[rx] === "1") ctx.fillRect(x + rx, y + ry, 1, 1); });
}
