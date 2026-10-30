"use strict";
/* Menus: splash, seleccion de personaje, raiders y ajustes. */

// ------------------------------------------------------------ Pantallas: splash y seleccion de personaje
let screen = "splash";
let menuSel = 0, rosterSel = 0, setSel = 0;
const pick = { cur: [0, 1], ready: [false, false], joined: [true, false] };
const STAT_BARS = [
  { label: "spd", key: "spd" },
  { label: "hp", key: "hp" },
  { label: "dmg", key: "dmg" },
];
const CHAR_UI = [{ spd: 3, hp: 3, dmg: 3 }, { spd: 2, hp: 5, dmg: 5 }, { spd: 4, hp: 4, dmg: 4 }];

const TXT = {
  es: { choose: "Elige personaje", pressA: "A elegir", ready: "Listo", spd: "Vel", hp: "Vida", dmg: "Dano", weapon: "Arma", special: "Especial",
    raiders: "Raiders", settings: "Ajustes", language: "Idioma", langName: "Espanol", sound: "Sonido", music: "Musica", sfx: "Efectos", back: "Volver",
    hintSplash: "Izq/Der elegir, F aceptar", hintSelect: "Izq/Der elegir, F confirmar, G cancelar; J2: pulsa , para unirte",
    hintRaiders: "Izq/Der elegir, F ver ficha, G volver", hintSheet: "Izq/Der cambiar personaje, G volver", hintSettings: "Arriba/Abajo elegir, Izq/Der cambiar, G volver" },
  en: { choose: "Choose character", pressA: "A choose", ready: "Ready", spd: "Speed", hp: "HP", dmg: "Damage", weapon: "Weapon", special: "Special",
    raiders: "Raiders", settings: "Settings", language: "Language", langName: "English", sound: "Sound", music: "Music", sfx: "Effects", back: "Back",
    hintSplash: "Left/Right choose, F accept", hintSelect: "Left/Right choose, F confirm, G cancel; P2: press , to join",
    hintRaiders: "Left/Right choose, F details, G back", hintSheet: "Left/Right change character, G back", hintSettings: "Up/Down choose, Left/Right change, G back" },
};
const tr = (k) => TXT[settings.lang ? "en" : "es"][k];
const CHAR_INFO = [
  { es: { weapon: "Bazuca con explosion que dana a los enemigos cercanos.", special: "Area 3x3 con dano continuo." },
    en: { weapon: "Bazooka whose blast hurts nearby enemies.", special: "3x3 area with continuous damage." } },
  { es: { weapon: "Ametralladora, 15 balas por segundo con dispersion. Mucha vida, pero lento.", special: "Area 5x2 con dano x3 instantaneo." },
    en: { weapon: "Machine gun, 15 bullets per second with spread. Lots of HP, but slow.", special: "5x2 area with instant x3 damage." } },
  { es: { weapon: "Espada, 5 golpes por segundo, alcance de 2 tiles. Rapido y resistente.", special: "Proyectil que atraviesa y destruye todo." },
    en: { weapon: "Sword, 5 hits per second, 2 tile reach. Fast and sturdy.", special: "Projectile that pierces and destroys everything." } },
];
const charName = (i) => CHARS[i].name[0] + CHARS[i].name.slice(1).toLowerCase();

function openSelect() {
  screen = "select";
  pick.ready = [false, false];
  pick.joined = [true, false];
  pick.cur = [chars[0], chars[1]];
}
function openRaiders() { screen = "raiders"; }
function openSettings() { screen = "settings"; setSel = 0; }

function updateMenu() {
  rand16(); // la semilla depende del momento en que el jugador pulsa
  const pr0 = input.pressed[0], pr1 = input.pressed[1];
  const any = pr0 | pr1;
  const ok = any & (BTN.A | BTN.START), back = any & BTN.B;
  const dx = (any & BTN.RIGHT ? 1 : 0) - (any & BTN.LEFT ? 1 : 0);
  const dy = (any & BTN.DOWN ? 1 : 0) - (any & BTN.UP ? 1 : 0);
  if (screen === "splash") {
    if (dx) { menuSel = (menuSel + 3 + dx) % 3; sfx("hit"); }
    if (ok) { sfx("coin"); [openSelect, openRaiders, openSettings][menuSel](); }
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
    const pr = pressedBy[i];
    if (!pick.joined[i]) {
      if (pr & (BTN.A | BTN.START | BTN.LEFT | BTN.RIGHT)) { pick.joined[i] = true; sfx("coin"); }
      continue;
    }
    if (!pick.ready[i]) {
      const n = CHARS.length;
      if (pr & BTN.LEFT) { pick.cur[i] = (pick.cur[i] + n - 1) % n; sfx("hit"); }
      if (pr & BTN.RIGHT) { pick.cur[i] = (pick.cur[i] + 1) % n; sfx("hit"); }
      if (pr & (BTN.A | BTN.START)) { pick.ready[i] = true; sfx("coin"); }
      else if (i === 0 && (pr & BTN.B)) screen = "splash";
    } else if (pr & BTN.B) {
      pick.ready[i] = false;
    } else if (i === 1 && (pr & BTN.SELECT)) {
      pick.joined[1] = false;
      pick.ready[1] = false;
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
  ["Play", "Raiders", "Settings"].forEach((label, i) => {
    const cx = 27 + i * 53;
    const sel = i === menuSel;
    ctx.globalAlpha = sel ? 1 : 0.55;
    drawTextCentered(ctx, label, 106, cx);
    ctx.globalAlpha = 1;
    if (sel && ((frame >> 4) & 1) === 0) {
      ctx.fillStyle = "#7a953a";
      ctx.fillRect(cx - 2, 100, 5, 1);
      ctx.fillRect(cx - 1, 101, 3, 1);
      ctx.fillRect(cx, 102, 1, 1);
      ctx.fillRect(cx - 2, 118, 5, 1);
      ctx.fillRect(cx - 1, 117, 3, 1);
      ctx.fillRect(cx, 116, 1, 1);
    }
  });
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

function drawPortraitFrame(ctx, i, bx, by, framed) {
  ctx.fillStyle = framed ? "#7a953a" : "#55742a";
  ctx.fillRect(bx, by, 44, 38);
  ctx.fillStyle = "#2a4e19";
  ctx.fillRect(bx + 2, by + 2, 40, 34);
  ctx.drawImage(assets.portraitsImage, i * 30, 0, 30, 30, bx + 7, by + 4, 30, 30);
}

function drawRoster(ctx) {
  drawBackdrop(ctx);
  drawTextCentered(ctx, tr("raiders"), 8);
  CHARS.forEach((c, i) => {
    const bx = 8 + i * 52;
    drawPortraitFrame(ctx, i, bx, 40, i === rosterSel);
    ctx.globalAlpha = i === rosterSel ? 1 : 0.55;
    drawTextCentered(ctx, charName(i), 82, bx + 22);
    ctx.globalAlpha = 1;
    if (i === rosterSel && ((frame >> 4) & 1) === 0) {
      ctx.fillStyle = "#7a953a";
      ctx.fillRect(bx + 19, 94, 5, 1);
      ctx.fillRect(bx + 20, 93, 3, 1);
      ctx.fillRect(bx + 21, 92, 1, 1);
    }
  });
}

function drawSheet(ctx) {
  drawBackdrop(ctx);
  const i = rosterSel, ui = CHAR_UI[i], info = CHAR_INFO[i][settings.lang ? "en" : "es"];
  ctx.fillStyle = "#7a953a";
  ctx.fillRect(6, 6, 64, 64);
  ctx.fillStyle = "#2a4e19";
  ctx.fillRect(8, 8, 60, 60);
  ctx.drawImage(assets.portraitsImage, i * 30, 0, 30, 30, 8, 8, 60, 60);
  drawText(ctx, charName(i), 78, 8);
  STAT_BARS.forEach((s, n) => {
    const y = 22 + n * 15;
    drawText(ctx, tr(s.label), 78, y);
    drawBars(ctx, 78, y + 9, ui[s.key], 5, 6, 1);
  });
  let y = 76;
  [["weapon", info.weapon], ["special", info.special]].forEach(([k, text]) => {
    drawText(ctx, tr(k), 8, y);
    ctx.fillStyle = "#55742a";
    ctx.fillRect(8, y + 8, 144, 1);
    wrapText(text, 144).slice(0, 3).forEach((line, n) => drawText(ctx, line, 8, y + 11 + n * 8));
    y += 38;
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
  drawBackdrop(ctx);
  const center = (str, y) => drawTextCentered(ctx, str, y);
  center(tr("choose"), 6);
  CHARS.forEach((c, i) => {
    const bx = 8 + i * 52;
    const by = 24;
    drawPortraitFrame(ctx, i, bx, by, false);
    drawTextCentered(ctx, charName(i), by + 41, bx + 22);
    for (let pi = 0; pi < 2; pi++) {
      if (!pick.joined[pi] || pick.cur[pi] !== i) continue;
      const mx = bx + (pi ? 28 : 4);
      const my = pi ? by + 60 : by - 6;
      const on = pick.ready[pi] || ((frame >> 4) & 1);
      ctx.fillStyle = on ? "#7a953a" : "#55742a";
      ctx.fillRect(mx, my, 12, 6);
      ctx.fillStyle = "#0f380f";
      drawTextTiny(ctx, String(pi + 1), mx + 3, my + 1);
      if (pick.ready[pi]) { ctx.strokeStyle = "#7a953a"; ctx.strokeRect(bx + 0.5, by + 0.5, 43, 37); }
    }
  });
  const ui = CHAR_UI[pick.cur[0]];
  STAT_BARS.forEach((s, i) => {
    const y = 100 + i * 9;
    drawText(ctx, tr(s.label), 8, y);
    drawBars(ctx, 48, y + 2, ui[s.key], 5, 8, 2);
  });
  if (((frame >> 4) & 1) && !pick.joined[1]) drawText(ctx, "J2 A", 112, 100);
  if (pick.ready[0] && ((frame >> 4) & 1)) center(tr("ready"), 128);
  else if (!pick.ready[0]) center(tr("pressA"), 128);
}

// Digito diminuto 3x5 para las etiquetas de jugador.
function drawTextTiny(ctx, str, x, y) {
  const glyphs = { 1: ["010", "110", "010", "010", "111"], 2: ["110", "001", "010", "100", "111"] };
  const g = glyphs[str];
  if (!g) return;
  g.forEach((row, ry) => { for (let rx = 0; rx < 3; rx++) if (row[rx] === "1") ctx.fillRect(x + rx, y + ry, 1, 1); });
}

