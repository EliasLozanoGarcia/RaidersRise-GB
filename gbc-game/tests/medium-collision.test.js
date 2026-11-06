"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function setup() {
  const context = vm.createContext({ window: {}, console });
  vm.runInContext(`
    let MAP_W = 20, MAP_H = 16;
    const VIEW_H = 120;
    const cam = { x: 0, y: 0 };
    const BBOX = { x: 0, y: 0, w: 1, h: 1 };
    const CFG = { bulletEdgeSlack: 2, bulletHitPad: 2, bulletGroundOffset: 6,
      bulletLinger: 4, fuseRadius: 8, barrierHp: 1, hurtFlash: 6, nudgePixels: 3 };
    let enemies = [], bullets = [];
    function overlap() { return false; }
    function sfx() {}
    function lv() { return 0; }
    function explode() {}
    function damageEnemy() {}
  `, context);
  for (const file of ["tiles.js", "physics.js", "interactives.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", file), "utf8"), context);
  }
  const main = fs.readFileSync(path.join(__dirname, "..", "js", "main.js"), "utf8");
  vm.runInContext(main.slice(0, main.indexOf("\nstart().catch")), context);
  vm.runInContext(`
    itemsLayer = Array(MAP_W * MAP_H).fill(-1);
    fondoLayer = Array(MAP_W * MAP_H).fill(49);
    itemsAttrs = Array(MAP_W * MAP_H).fill(0);
    fondoAttrs = Array(MAP_W * MAP_H).fill(0);
    setItemTile = (idx, tile, attr = 0) => { itemsLayer[idx] = tile; itemsAttrs[idx] = attr; };
  `, context);
  return (code) => vm.runInContext(code, context);
}

test("todos los IDs medios atraviesan la colision de balas y abejas", () => {
  const run = setup();
  const ids = run("Array.from(new Set([...COL_MEDIA, ...COL_MEDIA_T, ...COL_MEDIA_R, ...COL_MEDIA_D, ...COL_MEDIA_L]))");
  for (const id of ids) {
    run(`itemsLayer[3 * MAP_W + 3] = ${id}`);
    assert.equal(run(`getTileCollision(${id})`), 1, `clasificacion ${id}`);
    for (let y = 24; y < 32; y++) {
      for (let x = 24; x < 32; x++) {
        assert.equal(run(`boxBlocked(${x}, ${y}, BBOX, true)`), false, `tile ${id}, ${x}, ${y}`);
      }
    }
    assert.equal(run("boxBlocked(24, 24, { x: 0, y: 0, w: 8, h: 8 }, false)"), true, `terrestre ${id}`);
  }
});

test("abejas atraviesan tiles medios pero no solidos ni limites del mapa", () => {
  const run = setup();
  run("itemsLayer[3 * MAP_W + 3] = 8");
  run("var bee = { x: 16 << 8, y: 24 << 8, flying: true }");
  assert.equal(run("tryMove(bee, 8 << 8, 0, { x: 0, y: 0, w: 8, h: 8 }, false)"), true);
  assert.equal(run("bee.x >> 8"), 24);
  run("itemsLayer[3 * MAP_W + 4] = 0");
  assert.equal(run("tryMove(bee, 8 << 8, 0, { x: 0, y: 0, w: 8, h: 8 }, false)"), false);
  assert.equal(run("boxBlocked(-1, 24, BBOX, true)"), true);
  run("fondoLayer[3 * MAP_W + 3] = 0");
  assert.equal(run("boxBlocked(24, 24, BBOX, true)"), true);
});

test("una abeja y una bala atraviesan el tile 8 real de Level1-1", () => {
  const run = setup();
  const readLayer = (name) => fs.readFileSync(path.join(__dirname, "..", "maps", name), "utf8")
    .trim().split(/\r?\n/).flatMap((row) => row.split(",").map((value) => {
      const raw = Number(value);
      return raw === -1 || (raw & 0x20000000) ? -1 : raw & 0x0fffffff;
    }));
  const floor = readLayer("Level1-1_Fondo.csv");
  const items = readLayer("Level1-1_Items.csv");
  run(`fondoLayer = ${JSON.stringify(floor)}; itemsLayer = ${JSON.stringify(items)}`);
  assert.equal(run("fondoLayer[5 * MAP_W + 7]"), 8);
  run(`
    var bee = { x: 50 << 8, y: 40 << 8, flying: true };
    for (let i = 0; i < 18; i++) tryMove(bee, 256, 0, { x: 1, y: 1, w: 6, h: 6 }, false);
    bullets = [{ x: 50 << 8, y: 40 << 8, vx: 3 << 8, vy: 0, life: 100 << 8, direct: true }];
    for (let i = 0; i < 6; i++) updateBullets();
  `);
  assert.equal(run("bee.x >> 8"), 68);
  assert.equal(run("bullets.length"), 1);
  assert.equal(run("bullets[0].x >> 8"), 68);
  assert.equal(run("bullets[0].linger"), undefined);
});

test("Level1-2 distingue el tile 8 del borde inferior solido", () => {
  const run = setup();
  const readLayer = (name) => fs.readFileSync(path.join(__dirname, "..", "maps", name), "utf8")
    .trim().split(/\r?\n/).flatMap((row) => row.split(",").map((value) => {
      const raw = Number(value);
      return raw === -1 || (raw & 0x20000000) ? -1 : raw & 0x0fffffff;
    }));
  const floor = readLayer("Level1-2_Fondo.csv");
  const items = readLayer("Level1-2_Items.csv");
  run(`MAP_W = 32; MAP_H = 32; fondoLayer = ${JSON.stringify(floor)}; itemsLayer = ${JSON.stringify(items)}`);
  assert.equal(run("fondoLayer[24 * MAP_W + 10]"), 8);
  run(`
    var bee = { x: 80 << 8, y: 200 << 8, flying: true };
    for (let i = 0; i < 20; i++) tryMove(bee, 0, -256, { x: 1, y: 1, w: 6, h: 6 }, false);
    bullets = [{ x: 84 << 8, y: 205 << 8, vx: 0, vy: -3 << 8, life: 100 << 8, direct: true }];
    for (let i = 0; i < 7; i++) updateBullets();
  `);
  assert.equal(run("bee.y >> 8"), 180);
  assert.equal(run("bullets.length"), 1);
  assert.equal(run("bullets[0].linger"), undefined);
  assert.equal(run("fondoLayer[30 * MAP_W + 10]"), 7);
  assert.equal(run("fondoLayer[31 * MAP_W + 10]"), 39);
  assert.equal(run("getTileCollision(7)"), 2);
  assert.equal(run("getTileCollision(39)"), 2);
  assert.equal(run("boxBlocked(84, 256, BBOX, true)"), true);
});

test("Level1-7 permite atravesar filas reales y paredes de tiles 40 y 41", () => {
  const run = setup();
  const readLayer = (name) => fs.readFileSync(path.join(__dirname, "..", "maps", name), "utf8")
    .trim().split(/\r?\n/).flatMap((row) => row.split(",").map((value) => {
      const raw = Number(value);
      return raw === -1 || (raw & 0x20000000) ? -1 : raw & 0x0fffffff;
    }));
  const floor = readLayer("Level1-7_Fondo.csv");
  const items = readLayer("Level1-7_Items.csv");
  run(`MAP_H = 32; fondoLayer = ${JSON.stringify(floor)}; itemsLayer = ${JSON.stringify(items)}`);
  assert.equal(run("fondoLayer[23 * MAP_W + 9]"), 40);
  assert.equal(run("fondoLayer[15 * MAP_W + 5]"), 41);
  run(`
    var bee = { x: 72 << 8, y: 200 << 8, flying: true };
    for (let i = 0; i < 24; i++) tryMove(bee, 0, -256, { x: 1, y: 1, w: 6, h: 6 }, false);
    bullets = [{ x: 76 << 8, y: 205 << 8, vx: 0, vy: -3 << 8, life: 100 << 8, direct: true }];
    for (let i = 0; i < 9; i++) updateBullets();
  `);
  assert.equal(run("bee.y >> 8"), 176);
  assert.equal(run("bullets.length"), 1);
  assert.equal(run("bullets[0].linger"), undefined);
  run(`
    bee = { x: 32 << 8, y: 120 << 8, flying: true };
    for (let i = 0; i < 24; i++) tryMove(bee, 256, 0, { x: 1, y: 1, w: 6, h: 6 }, false);
    bullets = [{ x: 32 << 8, y: 116 << 8, vx: 3 << 8, vy: 0, life: 100 << 8, direct: true }];
    for (let i = 0; i < 8; i++) updateBullets();
  `);
  assert.equal(run("bee.x >> 8"), 56);
  assert.equal(run("bullets.length"), 1);
  assert.equal(run("bullets[0].linger"), undefined);
  assert.equal(run("boxBlocked(40, 120, { x: 0, y: 0, w: 8, h: 8 }, false)"), true);
});

test("proyectiles atraviesan barreras medias y las golpean una vez", () => {
  const run = setup();
  run(`
    itemsLayer[3 * MAP_W + 3] = 19;
    bullets = [{ x: 21 << 8, y: 24 << 8, vx: 1 << 8, vy: 0, life: 100 << 8, direct: true }];
    updateBullets();
  `);
  assert.equal(run("bullets.length"), 1);
  assert.equal(run("bullets[0].linger"), undefined);
  assert.equal(run("itemsLayer[3 * MAP_W + 3]"), 21);
  run("updateBullets(); updateBullets(); updateBullets()");
  assert.equal(run("itemsLayer[3 * MAP_W + 3]"), 21);
  assert.equal(run("bullets[0].linger"), undefined);
});

test("proyectiles siguen chocando con lucky blocks y tiles solidos", () => {
  const run = setup();
  run(`
    itemsLayer[3 * MAP_W + 3] = 27;
    luckyBoxes = [{ tx: 3, ty: 3, hp: 3, alive: true }];
    bullets = [{ x: 20 << 8, y: 24 << 8, vx: 4 << 8, vy: 0, life: 100 << 8, direct: true }];
    updateBullets();
  `);
  assert.equal(run("luckyBoxes[0].hp"), 2);
  assert.equal(run("bullets[0].linger"), 4);
  run("itemsLayer[3 * MAP_W + 3] = 0; luckyBoxes = []");
  assert.equal(run("bulletBlocked({ vx: 256, vy: 0 }, 27, 27)"), true);
});

test("el rayo atraviesa tiles medios y se detiene ante solidos", () => {
  const run = setup();
  run(`
    itemsLayer[3 * MAP_W + 3] = 8;
    bullets = [{ x: 20 << 8, y: 27 << 8, vx: 4 << 8, vy: 0, life: 100 << 8, beam: true }];
    updateBullets();
  `);
  assert.equal(run("bullets.length"), 1);
  run("itemsLayer[3 * MAP_W + 3] = 0; updateBullets()");
  assert.equal(run("bullets.length"), 0);
});
