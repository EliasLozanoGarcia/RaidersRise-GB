"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function setup() {
  const context = vm.createContext({ console });
  vm.runInContext(`
    const PICKUP = { heart: 152, coin: 153, mana: 154, crystal: 155 };
    const VIEW_H = 120, HUD_H = 24, GBC_W = 160;
    const CFG = { specialCharge: 120 };
    let frame = 0;
    let players = [{ id: 0, active: true, hp: 9, mana: 0, coins: 99, crystals: 99 }];
    const palette = [0x7a953a, 0x4b6e1a, 0x0f380f, 0x002204];
    const atlasPixels = new Uint8ClampedArray(8 * 8 * 4);
    for (let i = 0; i < 64; i++) {
      const color = palette[i % 4], p = i * 4;
      atlasPixels[p] = color >> 16; atlasPixels[p + 1] = (color >> 8) & 255;
      atlasPixels[p + 2] = color & 255; atlasPixels[p + 3] = 255;
    }
    const atlas = { pixels: atlasPixels };
    const assets = { biomeTilesets: [atlas], tilesetImage: {}, pickupTileset: {} };
    const document = { createElement() {
      const canvas = { width: 0, height: 0 };
      const ctx = {
        drawImage(image) { canvas.pixels = new Uint8ClampedArray(image.pixels); },
        getImageData() { return { data: new Uint8ClampedArray(canvas.pixels) }; },
        putImageData(data) { canvas.pixels = data.data; }
      };
      canvas.getContext = () => ctx;
      return canvas;
    } };
  `, context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "render.js"), "utf8"), context);
  vm.runInContext(`
    initHud();
    const calls = [];
    drawHudTile = (ctx, id, x, y, attr = 0) => calls.push({ kind: "tile", id, x, y, attr });
    drawHudImage = (ctx, image, sx, sy, x, y, attr = 0) =>
      calls.push({ kind: "bar", image: image === hudBarHalf ? "half" : image === hudBarFull ? "full"
        : image === hudBarEndHalf ? "endHalf" : image === hudBarLoopHalf ? "loopHalf"
        : image === hudBarLoopFull ? "loopFull" : "top", x, y, attr });
    drawGlyph = (ctx, id, x, y) => calls.push({ kind: "icon", id, x, y });
    drawHudNumber = (ctx, value, x, y, width) => calls.push({ kind: "number", value, x, y, width });
    drawText = (ctx, text, x, y) => calls.push({ kind: "text", text, x, y });
    const ctx = { fillRect() {} };
    const bar = () => calls.filter(c => c.y === 128 && c.x >= 40 && c.x <= 80);
  `, context);
  return (code) => vm.runInContext(code, context);
}

test("las variantes de mana remapean exactamente los tonos solicitados", () => {
  const run = setup();
  const firstPixels = (name) => Array.from(run(`${name}.pixels.slice(0, 16)`));
  assert.deepEqual(firstPixels("hudBarHalf"), [
    122, 149, 58, 255, 15, 56, 15, 255, 15, 56, 15, 255, 0, 34, 4, 255
  ]);
  assert.deepEqual(firstPixels("hudBarFull"), [
    122, 149, 58, 255, 122, 149, 58, 255, 15, 56, 15, 255, 0, 34, 4, 255
  ]);
  assert.deepEqual(firstPixels("hudBarEndHalf"), [
    15, 56, 15, 255, 122, 149, 58, 255, 15, 56, 15, 255, 0, 34, 4, 255
  ]);
});

test("la barra usa seis tiles y llena cada mitad, incluidos los extremos volteados", () => {
  const run = setup();
  const getBar = (mana) => {
    run(`players[0].mana = ${mana}; calls.length = 0; drawHud(ctx)`);
    return JSON.parse(run("JSON.stringify(bar())"));
  };
  assert.deepEqual(getBar(0).map(c => [c.id, c.attr]), [[138, 0], [140, 0], [140, 0], [140, 0], [140, 0], [138, 96]]);
  assert.equal(getBar(9)[0].id, 138);
  assert.equal(getBar(10)[0].image, "half");
  assert.equal(getBar(20)[0].image, "full");
  assert.equal(getBar(30)[1].image, "loopHalf");
  const almostFull = getBar(110);
  assert.equal(almostFull[5].image, "endHalf");
  assert.equal(almostFull[5].attr, 96);
  const full = getBar(120);
  assert.deepEqual(full.map(c => c.image), ["full", "loopFull", "loopFull", "loopFull", "loopFull", "full"]);
  assert.equal(full[5].attr, 96);
  assert.deepEqual(getBar(121), full);
});

test("el panel sigue el mockup y alterna jugadores sin cambiar sus datos", () => {
  const run = setup();
  run("drawHud(ctx)");
  assert.equal(run("calls.filter(c => c.kind === 'bar' && c.image === 'top').length"), 18);
  assert.equal(run("[80,81,103,104,119,120,125,126,127].every(id => calls.some(c => c.kind === 'tile' && c.id === id))"), true);
  assert.equal(run("calls.filter(c => c.kind === 'icon').map(c => c.id).join(',')"), "152,154,153,155");
  assert.equal(run("calls.filter(c => c.kind === 'number').map(c => c.value).join(',')"), "9,99,99");
  run(`
    players.push({ id: 1, active: true, hp: 3, mana: 120, coins: 12, crystals: 4 });
    frame = 180; calls.length = 0; drawHud(ctx);
  `);
  assert.equal(run("calls.filter(c => c.kind === 'number').map(c => c.value).join(',')"), "3,12,4,2");
  assert.equal(run("bar().map(c => c.image).join(',')"), "full,loopFull,loopFull,loopFull,loopFull,full");
  run("frame = 360; calls.length = 0; drawHud(ctx)");
  assert.equal(run("calls.filter(c => c.kind === 'number').map(c => c.value).join(',')"), "9,99,99,1");
});

test("la recarga parpadea fuera del panel e identifica a ambos jugadores", () => {
  const run = setup();
  run(`players[0].reloadT = 20; frame = 8; drawHud(ctx)`);
  assert.equal(run("calls.find(c => c.kind === 'text').text"), "RELOAD");
  assert.equal(run("calls.find(c => c.kind === 'text').y"), 112);
  run(`players.push({ id: 1, active: true, hp: 3, mana: 0, coins: 0, crystals: 0, reloadT: 20 });
    calls.length = 0; drawHud(ctx)`);
  assert.equal(run("calls.filter(c => c.kind === 'text').map(c => c.text).join(',')"), "P1 RELOAD,P2 RELOAD");
  run("frame = 16; calls.length = 0; drawHud(ctx)");
  assert.equal(run("calls.some(c => c.kind === 'text')"), false);
});
