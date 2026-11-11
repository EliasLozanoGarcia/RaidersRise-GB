"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function setup() {
  const context = vm.createContext({ console });
  vm.runInContext(`
    const BTN = { UP: 1, DOWN: 2, LEFT: 4, RIGHT: 8, A: 16, B: 32, START: 64, SELECT: 128 };
    const input = { pressed: [0, 0], held: [0, 0] };
    const settings = { lang: 0 };
    const CHARS = [{ name: "KATHY" }, { name: "KURT" }, { name: "SKREEK" }];
    const chars = [0, 1], players = [{ active: true }, { active: false }];
    const GBC_W = 160, GBC_H = 144;
    const assets = { splashMap: { tiles: [], cols: 16, w: 20 }, qrImage: {}, aboutQrImage: { name: "about-qr" },
      selectionImage: { name: "selection" }, profileImage: { name: "profile" } };
    let frame = 0;
    const calls = [], fills = [], images = [], texts = [], textCalls = [], clips = [];
    const ctx = { fillRect(...args) { calls.push(args); fills.push([this.fillStyle, ...args]); },
      drawImage(...args) { images.push(args); }, beginPath() {}, rect(...args) { clips.push(args); },
      save() {}, restore() {}, clip() {} };
    function rand16() {}
    function sfx() {}
    function resetGame() { players[1].active = false; }
    function textWidth(s) { return s.length * 4; }
    function drawTextCentered(ctx, text, y) { texts.push(text); textCalls.push([text, y]); }
    function drawText(ctx, text, x, y) { texts.push(text); textCalls.push([text, y]); }
    function wrapText(s) { return [s]; }
  `, context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "menus.js"), "utf8"), context);
  return (code) => vm.runInContext(code, context);
}

test("el menu vertical recorre cuatro opciones y vuelve al principio", () => {
  const run = setup();
  run("input.pressed[0] = BTN.UP; updateMenu()");
  assert.equal(run("menuSel"), 3);
  run("input.pressed[0] = BTN.DOWN; updateMenu()");
  assert.equal(run("menuSel"), 0);
  run("input.pressed[0] = BTN.RIGHT; updateMenu()");
  assert.equal(run("menuSel"), 0);
  run("input.pressed[0] = BTN.DOWN; updateMenu(); updateMenu(); input.pressed[0] = BTN.A; updateMenu()");
  assert.equal(run("screen"), "raiders");
});

test("las flechas permanecen visibles y se desplazan un pixel cada 30 frames", () => {
  const run = setup();
  run("frame = 0; drawSplash(ctx)");
  const first = JSON.parse(run("JSON.stringify(calls)"));
  run("calls.length = 0; frame = 29; drawSplash(ctx)");
  assert.deepEqual(JSON.parse(run("JSON.stringify(calls)")), first);
  run("calls.length = 0; frame = 30; drawSplash(ctx)");
  const outside = JSON.parse(run("JSON.stringify(calls)"));
  assert.equal(outside.length, 7);
  assert.deepEqual(outside[0], first[0]);
  assert.equal(outside[1][0], first[1][0] - 1);
  assert.equal(outside[4][0], first[4][0] + 1);
  run("calls.length = 0; frame = 60; drawSplash(ctx)");
  assert.deepEqual(JSON.parse(run("JSON.stringify(calls)")), first);
});

test("single player ignora al segundo jugador y empieza con uno solo", () => {
  const run = setup();
  run("input.pressed = [BTN.A, 0]; updateMenu()");
  assert.equal(run("screen"), "select");
  run("input.pressed = [0, BTN.A]; updateMenu()");
  assert.equal(run("pick.joined[1]"), false);
  assert.equal(run("screen"), "select");
  run("input.pressed = [BTN.A, 0]; updateMenu()");
  assert.equal(run("screen"), "game");
  assert.equal(run("players[1].active"), false);
});

test("multiplayer exige la confirmacion de ambos jugadores", () => {
  const run = setup();
  run("menuSel = 1; input.pressed = [BTN.A, 0]; updateMenu()");
  assert.equal(run("pick.joined[1]"), true);
  run("input.pressed = [BTN.A, 0]; updateMenu()");
  assert.equal(run("screen"), "select");
  run("input.pressed = [0, BTN.A]; updateMenu()");
  assert.equal(run("screen"), "game");
  assert.equal(run("players[1].active"), true);
});

test("About desplaza una pagina continua pixel a pixel y limita el recorrido", () => {
  const run = setup();
  run("wrapText = () => Array.from({length: 20}, (_, i) => 'Linea ' + i)");
  run("menuSel = 3; input.pressed = [BTN.A, 0]; updateMenu()");
  assert.equal(run("screen"), "about");
  run("input.pressed = [0, 0]; input.held = [BTN.DOWN, 0]; updateMenu()");
  assert.equal(run("aboutScroll"), 1);
  run("for (let i = 0; i < 500; i++) updateMenu()");
  assert.equal(run("aboutScroll"), 160);
  run("drawAbout(ctx)");
  assert.deepEqual(JSON.parse(run("JSON.stringify(images[0].slice(1))")), [35, 46]);
  assert.equal(run("images[0][0] === assets.aboutQrImage"), true);
  assert.equal(run("texts.includes('Play on mobile') && texts.includes('Linea 19')"), true);
  assert.equal(run("texts.some(t => /^\\d+\\/\\d+$/.test(t))"), false);
  run("input.held = [0, BTN.UP]; updateMenu()");
  assert.equal(run("aboutScroll"), 159);
  run("for (let i = 0; i < 500; i++) updateMenu()");
  assert.equal(run("aboutScroll"), 0);
  run("input.held = [BTN.UP, BTN.DOWN]; updateMenu()");
  assert.equal(run("aboutScroll"), 0);
  run("input.pressed = [BTN.B, 0]; updateMenu()");
  assert.equal(run("screen"), "splash");
  run("aboutScroll = 10; openAbout()");
  assert.equal(run("aboutScroll"), 0);
});

test("el QR se convierte una vez a los verdes claro y oscuro sin suavizado", () => {
  const run = setup();
  run(`
    const qrData = { data: new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]) };
    const qrContext = {
      drawImage(...args) { this.drawArgs = args; },
      getImageData() { return qrData; },
      putImageData(data) { this.output = data; }
    };
    const qrCanvas = { getContext() { return qrContext; } };
    const document = { createElement() { return qrCanvas; } };
    initAboutQr();
  `);
  assert.equal(run("assets.aboutQrImage === qrCanvas"), true);
  assert.equal(run("qrCanvas.width === 90 && qrCanvas.height === 90"), true);
  assert.equal(run("qrContext.imageSmoothingEnabled"), false);
  assert.equal(run("qrContext.drawArgs[0] === assets.qrImage"), true);
  assert.deepEqual(Array.from(run("qrData.data")), [15, 56, 15, 255, 122, 149, 58, 255]);
  assert.equal(run("qrContext.output === qrData"), true);
});

test("la galeria presenta seis retratos y solo permite elegir los tres disponibles", () => {
  const run = setup();
  run("screen = 'raiders'; drawRoster(ctx)");
  assert.equal(run("images.length"), 27);
  assert.equal(run("images[21][0].name"), "profile");
  assert.equal(run("images.slice(22).every(call => call[0].name === 'selection')"), true);
  assert.equal(run("texts.join(',')"), "Kathy,Kurt,Skreek,Baba,Maya,Korin");
  run("input.pressed = [BTN.LEFT, 0]; updateMenu()");
  assert.equal(run("rosterSel"), 2);
  run("input.pressed = [BTN.RIGHT, 0]; updateMenu()");
  assert.equal(run("rosterSel"), 0);
  run("input.pressed = [BTN.A, 0]; updateMenu()");
  assert.equal(run("screen"), "sheet");
  run("input.pressed = [BTN.B, 0]; updateMenu()");
  assert.equal(run("screen"), "raiders");
});

test("la seleccion muestra los estados independientes de ambos jugadores", () => {
  const run = setup();
  run("multiplayer = true; openSelect(); pick.cur = [1, 1]; pick.ready = [true, false]; drawSelect(ctx)");
  assert.equal(run("fills.some(f => f[0] === '#7a953a' && f[1] === 72 && f[2] === 24 && f[3] === 32 && f[4] === 1)"), true);
  assert.equal(run("texts.includes('J1 Listo')"), true);
  assert.equal(run("texts.includes('J2 A elegir')"), true);
  run("texts.length = 0; pick.ready = [false, true]; drawSelect(ctx)");
  assert.equal(run("texts.includes('J1 A elegir')"), true);
  assert.equal(run("texts.includes('J2 Listo')"), true);
});

test("los numeros de jugador solo aparecen en multiplayer", () => {
  const run = setup();
  run("openSelect(); drawSelect(ctx)");
  assert.equal(run("fills.some(f => f[1] === 21 && f[2] === 21 && f[3] === 10 && f[4] === 7)"), false);
  run("fills.length = 0; multiplayer = true; openSelect(); drawSelect(ctx)");
  assert.equal(run("fills.some(f => f[1] === 21 && f[2] === 21 && f[3] === 10 && f[4] === 7)"), true);
  assert.equal(run("fills.some(f => f[1] === 87 && f[2] === 21 && f[3] === 10 && f[4] === 7)"), true);
});

test("seleccion y galeria repiten los tiles de fondo del mockup y usan marcos diagonales", () => {
  for (const draw of ["drawSelect", "drawRoster"]) {
    const run = setup();
    run(`${draw}(ctx)`);
    for (let col = 0; col < 20; col++) {
      assert.deepEqual(JSON.parse(run(`JSON.stringify(images[${col}].slice(1))`)),
        [0, 0, 8, 144, col * 8, 0, 8, 144]);
      assert.equal(run(`images[${col}][0] === assets.selectionImage`), true);
    }
    assert.deepEqual(JSON.parse(run("JSON.stringify(images[20].slice(1))")), [0, 0, 160, 20, 0, 0, 160, 20]);
    assert.equal(run("fills.some(f => f[1] === 0 && f[2] === 116 && f[3] === 160 && f[4] === 12)"), false);
    assert.equal(run("clips.length"), 6 * 40);
    for (let card = 0; card < 6; card++) {
      const x = 24 + (card % 3) * 40, y = 24 + Math.floor(card / 3) * 48;
      for (let row = 0; row < 40; row++) {
        assert.deepEqual(JSON.parse(run(`JSON.stringify(clips[${card * 40 + row}])`)),
          [x + 8 - Math.floor(row / 5), y + row, 32, 1]);
      }
    }
    const border = draw === "drawSelect" ? "#55742a" : "#7a953a";
    assert.equal(run(`fills.some(f => f[0] === '${border}' && f[1] === 32 && f[2] === 24 && f[3] === 32)`), true);
    assert.equal(run(`fills.some(f => f[0] === '${border}' && f[1] === 25 && f[2] === 63 && f[3] === 32)`), true);
    for (let row = 0; row < 40; row++) {
      const left = 32 - Math.floor(row / 5);
      assert.equal(run(`fills.some(f => f[0] === '#09270f' && f[1] === ${left - 1} && f[2] === ${24 + row} && f[3] === 34 && f[4] === 1)`), true);
    }
    assert.equal(run("fills.some(f => f[0] === '#09270f' && f[1] === 31 && f[2] === 23 && f[3] === 34)"), true);
    assert.equal(run("fills.some(f => f[0] === '#09270f' && f[1] === 24 && f[2] === 64 && f[3] === 34)"), true);
  }
});

test("la ficha usa el raider y el idioma elegidos sin truncar descripciones", () => {
  const run = setup();
  run(`
    CHARS[1].ui = { spd: 2, hp: 5, dmg: 5 };
    CHARS[1].info = { en: { weapon: "Weapon description", special: "Special description" } };
    settings.lang = 1; rosterSel = 1; drawSheet(ctx);
  `);
  assert.equal(run("images[0][0].name"), "profile");
  assert.equal(run("images[1][0].name"), "selection");
  assert.equal(run("images[1][1]"), 68);
  assert.equal(run("texts.includes('Kurt') && texts.includes('Weapon description') && texts.includes('Special description')"), true);
});
