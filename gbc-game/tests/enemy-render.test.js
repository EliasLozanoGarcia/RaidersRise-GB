"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function setup() {
  const context = vm.createContext({ console });
  vm.runInContext(`
    const calls = [];
    const gbc = { ctx: { clearRect() {}, fillRect() {}, drawImage(...args) { calls.push(args); } } };
    const document = {
      getElementById() { return {}; },
      createElement() {
        return {
          width: 0, height: 0,
          getContext() {
            let image;
            return {
              drawImage(img) { image = img; },
              getImageData() { return { data: image.pixels }; }
            };
          }
        };
      }
    };
    const GBC_W = 160, GBC_H = 144, VIEW_H = 120, HUD_H = 24;
    const PICKUP = { coin: 147, heart: 146 };
    const cam = { x: 0, y: 0 }, MAP_W = 0, MAP_H = 0;
    const CFG = { maxSprites: 40, maxSpritesPerLine: 10, enemyAnimFrames: 14, enemyTypes: {
      slime: { sprite: "enemyImage", size: 8 },
      bigSlime: { sprite: "bigSlugImage", size: 16 },
      bee: { sprite: "beeImage", size: 8 }
    } };
    function image(name, size, bottoms) {
      const img = { name, width: size * bottoms.length, height: size, pixels: new Uint8ClampedArray(size * bottoms.length * size * 4) };
      bottoms.forEach((y, i) => { if (y >= 0) img.pixels[(y * img.width + i * size) * 4 + 3] = 255; });
      return img;
    }
    const assets = { enemyImage: image("slug", 8, [7, 2]), bigSlugImage: image("big", 16, [15]), beeImage: image("bee", 8, [6, 3]) };
    const players = [], enemies = [], bullets = [], luckyBoxes = [], teleportEffects = [];
    const blasts = new Map(), barrierHit = new Map();
    let frame = 0, selFrame = -1, screen = "game", gameOver = false, paused = false, shop = null, wave = 0;
  `, context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "render.js"), "utf8"), context);
  vm.runInContext("initEnemyFrameBottoms()", context);
  return (code) => vm.runInContext(code, context);
}

test("dibuja las slugs mas arriba sin desplazar las abejas ni su posicion logica", () => {
  const run = setup();
  run(`
    enemies.push(
      { type: "slime", sprite: "enemyImage", size: 8, x: 16 << 8, y: 40 << 8, dir: 0, moving: false },
      { type: "bigSlime", sprite: "bigSlugImage", size: 16, x: 32 << 8, y: 40 << 8, dir: 0, moving: false },
      { type: "bee", sprite: "beeImage", size: 8, x: 56 << 8, y: 40 << 8, dir: 0, sheet: "flap" }
    );
    render();
  `);
  assert.equal(run("calls.find(c => c[0].name === 'slug')[6]"), 39);
  assert.equal(run("calls.find(c => c[0].name === 'big')[6]"), 38);
  assert.equal(run("calls.find(c => c[0].name === 'bee')[6]"), 40);
  assert.equal(run("enemies.every(e => e.y === 40 << 8)"), true);
});

test("ordena los enemigos por el pixel visible inferior, no por el orden del array", () => {
  const run = setup();
  run(`
    enemies.push(
      { type: "bigSlime", sprite: "bigSlugImage", size: 16, x: 16 << 8, y: 35 << 8, dir: 0 },
      { type: "slime", sprite: "enemyImage", size: 8, x: 16 << 8, y: 42 << 8, dir: 1 },
      { type: "bee", sprite: "beeImage", size: 8, x: 16 << 8, y: 40 << 8, dir: 0, sheet: "flap" }
    );
    render();
  `);
  assert.equal(run("calls.map(c => c[0].name).join(',')"), "slug,bee,big");
  assert.equal(run("enemies.map(e => e.sprite).join(',')"), "bigSlugImage,enemyImage,beeImage");
});

test("usa el fotograma actual para determinar la profundidad y conserva empates estables", () => {
  const run = setup();
  run(`
    enemies.push(
      { type: "slime", sprite: "enemyImage", size: 8, x: 16 << 8, y: 40 << 8, dir: 0 },
      { type: "bee", sprite: "beeImage", size: 8, x: 16 << 8, y: 40 << 8, dir: 0, sheet: "flap" }
    );
    render();
  `);
  assert.equal(run("calls.map(c => c[0].name).join(',')"), "slug,bee");
  run("calls.length = 0; frame = 2; render()");
  assert.equal(run("calls.map(c => c[0].name).join(',')"), "bee,slug");
});

test("no altera los limites de sprites ni muestra enemigos descartados", () => {
  const run = setup();
  run(`
    CFG.maxSprites = 1;
    enemies.push(
      { type: "slime", sprite: "enemyImage", size: 8, x: 16 << 8, y: 40 << 8, dir: 0 },
      { type: "bee", sprite: "beeImage", size: 8, x: 16 << 8, y: 40 << 8, dir: 0, sheet: "flap" }
    );
    render();
  `);
  assert.equal(run("calls.length"), 1);
  assert.equal(run("enemies.filter(e => e.vis).length"), 1);
});

test("ignora fotogramas completamente transparentes", () => {
  const run = setup();
  run(`
    assets.enemyImage = image("slug", 8, [-1]);
    initEnemyFrameBottoms();
    enemies.push({ type: "slime", sprite: "enemyImage", size: 8, x: 16 << 8, y: 40 << 8, dir: 0 });
    render();
  `);
  assert.equal(run("calls.length"), 0);
});

test("el descarte en el borde utiliza la posicion visual ajustada", () => {
  const run = setup();
  run(`
    enemies.push(
      { type: "slime", sprite: "enemyImage", size: 8, x: 16 << 8, y: 120 << 8, dir: 0 },
      { type: "bigSlime", sprite: "bigSlugImage", size: 16, x: 32 << 8, y: 121 << 8, dir: 0 },
      { type: "bee", sprite: "beeImage", size: 8, x: 56 << 8, y: 120 << 8, dir: 0, sheet: "flap" }
    );
    render();
  `);
  assert.equal(run("enemies[0].vis"), true);
  assert.equal(run("enemies[1].vis"), true);
  assert.equal(run("enemies[2].vis"), false);
  assert.equal(run("calls.length"), 2);
});
