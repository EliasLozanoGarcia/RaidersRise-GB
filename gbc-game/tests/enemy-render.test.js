"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function setup() {
  const context = vm.createContext({ console, window: {}, DMGLoader: { init: () => new Promise(() => {}) } });
  vm.runInContext(`
    const calls = [];
    const transforms = [];
    const gbc = { ctx: { clearRect() {}, fillRect() {}, save() { transforms.push("save"); },
      restore() { transforms.push("restore"); }, beginPath() {}, rect() {}, clip() {},
      translate(x, y) { transforms.push([x, y]); }, drawImage(...args) { calls.push(args); } } };
    const document = {
      getElementById() { return {}; },
      createElement() {
        return {
          width: 0, height: 0,
          getContext() {
            const canvas = this;
            let image;
            return {
              drawImage(img) { image = img; },
              getImageData() { return { data: new Uint8ClampedArray(image.pixels) }; },
              putImageData(data) { canvas.pixels = data.data; }
            };
          }
        };
      }
    };
    const GBC_W = 160, GBC_H = 144, VIEW_H = 120, HUD_H = 24;
    const PICKUP = { coin: 147, heart: 146 };
    const cam = { x: 0, y: 0 }, MAP_W = 0, MAP_H = 0;
    const CFG = { maxSprites: 40, maxSpritesPerLine: 10, enemyAnimFrames: 14, hurtFlash: 6, enemyTypes: {
      slime: { sprite: "enemyImage", size: 8 },
      bigSlime: { sprite: "bigSlugImage", size: 16 },
      bee: { sprite: "beeImage", size: 8 }
    } };
    function image(name, size, bottoms) {
      const img = { name, width: size * bottoms.length, height: size, pixels: new Uint8ClampedArray(size * bottoms.length * size * 4) };
      bottoms.forEach((y, i) => { if (y >= 0) img.pixels[(y * img.width + i * size) * 4 + 3] = 255; });
      return img;
    }
    const assets = { enemyImage: image("slug", 8, [7, 2]), bigSlugImage: image("big", 16, [15]),
      beeImage: image("bee", 8, [6, 3]), enemyDeathImage: { name: "death" } };
    const players = [], enemies = [], bullets = [], luckyBoxes = [], teleportEffects = [], specialExplosions = [];
    let enemyDeathEffects = [], stats = { kills: 0 };
    const blasts = new Map(), barrierHit = new Map();
    let frame = 0, selFrame = -1, screen = "game", gameOver = false, paused = false, shop = null, wave = 0, wallShake = 0;
    function sfx() {}
  `, context);
  for (const file of ["render.js", "entities.js", "main.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", file), "utf8"), context);
  }
  vm.runInContext("initEnemyFrameBottoms()", context);
  return (code) => vm.runInContext(code, context);
}

test("los enemigos heridos usan sus sprites aclarados y recuperan los originales", () => {
  const run = setup();
  run(`
    const colors = {
      enemyImage: [9, 39, 15, 255],
      bigSlugImage: [36, 77, 29, 255],
      beeImage: [75, 110, 26, 255]
    };
    for (const [key, color] of Object.entries(colors)) {
      assets[key].pixels.fill(0);
      assets[key].pixels.set(color, 0);
      assets[key].pixels.set([9, 39, 15, 0], 4);
      assets[key].pixels.set([122, 149, 58, 255], 8);
    }
    Object.assign(hitImages, makeEnemyHitImages(Object.fromEntries(ENEMY_HIT_SPRITES.map(key => [key, assets[key]]))));
    enemies.push(
      { type: "slime", sprite: "enemyImage", size: 8, x: 16 << 8, y: 40 << 8, dir: 0, hp: 2 },
      { type: "bigSlime", sprite: "bigSlugImage", size: 16, x: 32 << 8, y: 40 << 8, dir: 0, hp: 4 },
      { type: "bee", sprite: "beeImage", size: 8, x: 56 << 8, y: 40 << 8, dir: 0, sheet: "flap", hp: 2 }
    );
    for (const e of enemies) damageEnemy(e, 1);
    render();
  `);
  for (const [key, expected] of [
    ["enemyImage", [36, 77, 29, 255]],
    ["bigSlugImage", [75, 110, 26, 255]],
    ["beeImage", [122, 149, 58, 255]]
  ]) {
    assert.deepEqual(Array.from(run(`hitImages.${key}.pixels.slice(0, 4)`)), expected);
    assert.deepEqual(Array.from(run(`hitImages.${key}.pixels.slice(4, 8)`)), [9, 39, 15, 0]);
    assert.deepEqual(Array.from(run(`hitImages.${key}.pixels.slice(8, 12)`)), [122, 149, 58, 255]);
    assert.equal(run(`calls.some(c => c[0] === hitImages.${key})`), true);
    assert.equal(run(`enemies.find(e => e.sprite === "${key}").hit`), 6);
  }
  run("calls.length = 0; for (const e of enemies) e.hit = 0; render()");
  for (const key of ["enemyImage", "bigSlugImage", "beeImage"]) {
    assert.equal(run(`calls.some(c => c[0] === assets.${key})`), true);
  }
});

test("al morir muestra un unico efecto de 8x8 centrado en la posicion visual", () => {
  const run = setup();
  run(`
    cam.x = 2; cam.y = 3;
    const small = { type: "slime", size: 8, x: 16 << 8, y: 40 << 8, hp: 1 };
    const big = { type: "bigSlime", size: 16, x: 32 << 8, y: 40 << 8, hp: 1 };
    const bee = { type: "bee", size: 8, x: 56 << 8, y: 40 << 8, hp: 1 };
    damageEnemy(small, 1); damageEnemy(small, 1);
    damageEnemy(big, 1); damageEnemy(bee, 1);
    render();
  `);
  assert.equal(run("stats.kills"), 3);
  assert.equal(run("enemyDeathEffects.length"), 3);
  assert.equal(run("enemyDeathEffects.every(e => e.age === 0)"), true);
  assert.deepEqual(JSON.parse(run("JSON.stringify(calls.filter(c => c[0] === assets.enemyDeathImage).map(c => c.slice(1)))")),
    [[14, 36], [34, 39], [54, 37]]);
});

test("la paleta aclarada admite colores transformados por el navegador y rechaza mas de cuatro", () => {
  const run = setup();
  run(`
    assets.enemyImage.pixels.fill(0);
    assets.enemyImage.pixels.set([0, 34, 4, 255, 0, 76, 17, 255, 50, 110, 0, 255, 109, 150, 46, 255]);
    const flashed = makeEnemyHitImages({ enemyImage: assets.enemyImage });
  `);
  assert.deepEqual(Array.from(run("flashed.enemyImage.pixels.slice(0, 16)")), [
    0, 76, 17, 255, 50, 110, 0, 255, 109, 150, 46, 255, 109, 150, 46, 255
  ]);
  run("assets.enemyImage.pixels.set([1, 2, 3, 255], 16)");
  assert.throws(() => run("makeEnemyHitImages({ enemyImage: assets.enemyImage })"), /debe tener 4 colores/);
});

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

test("la vibracion desplaza la escena pero no el HUD", () => {
  const run = setup();
  run(`wallShake = 6; drawHud = () => transforms.push("hud"); render()`);
  assert.equal(run("JSON.stringify(transforms)"), '["save",[1,0],"restore","hud"]');
  run("transforms.length = 0; wallShake = 5; render()");
  assert.equal(run("JSON.stringify(transforms)"), '["save",[-1,0],"restore","hud"]');
  run("transforms.length = 0; wallShake = 0; render()");
  assert.equal(run("JSON.stringify(transforms)"), '["save",[0,0],"restore","hud"]');
});
