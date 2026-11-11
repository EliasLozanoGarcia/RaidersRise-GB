"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function setup() {
  const context = vm.createContext({ window: {}, console });
  vm.runInContext(`
    const MAP_W = 12, MAP_H = 12;
    const PBOX = { x: 4, y: 10, w: 8, h: 6 };
    const players = [{ active: true, hp: 4, x: 28 << 8, y: 22 << 8 }];
    const enemies = [], input = { held: [0] }, itemsLayer = Array(144).fill(-1), itemsAttrs = Array(144).fill(0);
    function overlap(ax, ay, a, bx, by, b) {
      return ax + a.x < bx + b.x + b.w && ax + a.x + a.w > bx + b.x &&
        ay + a.y < by + b.y + b.h && ay + a.y + a.h > by + b.y;
    }
    function setItemTile(idx, tile) { itemsLayer[idx] = tile; }
    function sfx() {}
  `, context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "interactives.js"), "utf8"), context);
  vm.runInContext(`
    buttons = [{ tx: 4, ty: 4 }];
    lowerWalls = [{ shown: 0, timer: 0, cells: [{ idx: 50, row: 0, kind: 0 }] }];
  `, context);
  return (code) => vm.runInContext(code, context);
}

function setupCamera() {
  const context = vm.createContext({ window: {}, console });
  vm.runInContext(`
    const MAP_W = 80, MAP_H = 80, VIEW_H = 120;
    const cam = { x: 40, y: 40 };
    const PBOX = { x: 4, y: 10, w: 8, h: 6 };
    const players = [{ active: true, hp: 4, x: 28 << 8, y: 22 << 8, shield: 0 }];
    const enemies = [], input = { held: [0, 0], pressed: [0, 0] };
    const itemsLayer = Array(MAP_W * MAP_H).fill(-1), itemsAttrs = Array(MAP_W * MAP_H).fill(0);
    const BTN = { START: 64, UP: 1, DOWN: 2, A: 16 };
    let screen = "game", shop = null, gameOver = false, paused = false, multiplayer = false;
    let levelLogic = null, stats = { time: 0 }, teleportEffects = [], enemyDeathEffects = [], waveTimer = 100;
    const CFG = { teleportEffectFrames: 32, enemyDeathFrames: 12 }, blasts = new Map();
    const DMGLoader = { init: () => new Promise(() => {}) };
    function overlap(ax, ay, a, bx, by, b) {
      return ax + a.x < bx + b.x + b.w && ax + a.x + a.w > bx + b.x &&
        ay + a.y < by + b.y + b.h && ay + a.y + a.h > by + b.y;
    }
    function setItemTile(idx, tile) { itemsLayer[idx] = tile; }
    function sfx() {}
    function updateSpecialExplosions() {}
    function updateCoins() {}
    function updatePlayer(p) { p.x += 256; p.y += 256; }
    function updateEnemies() {}
    function updateSpawnPoints() {}
  `, context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "interactives.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "main.js"), "utf8"), context);
  vm.runInContext(`
    buttons = [{ tx: 4, ty: 4 }];
    lowerWalls = [{ shown: 0, timer: 0, cells: [{ idx: 50, row: 0, kind: 0 }] }];
    updateBullets = () => {};
  `, context);
  return (code) => vm.runInContext(code, context);
}

test("el efecto de muerte dura doce frames y se congela durante la pausa", () => {
  const run = setupCamera();
  run("enemyDeathEffects.push({age: 0}); paused = true; update()");
  assert.equal(run("enemyDeathEffects[0].age"), 0);
  run("paused = false; for (let i = 0; i < 11; i++) update()");
  assert.equal(run("enemyDeathEffects[0].age"), 11);
  run("update()");
  assert.equal(run("enemyDeathEffects.length"), 0);
});

test("cada fase del muro inicia una vibracion breve", () => {
  const run = setup();
  run("updateInteractives()");
  assert.equal(run("wallShake"), 6);
  assert.equal(run("lowerWalls[0].shown"), 1);
  run("for (let i = 0; i < 6; i++) updateInteractives()");
  assert.equal(run("wallShake"), 0);
  assert.equal(run("lowerWalls[0].shown"), 1);
  run("for (let i = 0; i < 17; i++) updateInteractives()");
  assert.equal(run("lowerWalls[0].shown"), 1);
  run("updateInteractives()");
  assert.equal(run("lowerWalls[0].shown"), 2);
  assert.equal(run("wallShake"), 6);
  run("for (let i = 0; i < 23; i++) updateInteractives()");
  assert.equal(run("lowerWalls[0].shown"), 2);
  run("updateInteractives()");
  assert.equal(run("lowerWalls[0].shown"), 3);
  assert.equal(run("wallShake"), 6);
});

test("al soltar el boton la vibracion termina y no se reinicia", () => {
  const run = setup();
  run("updateInteractives(); players[0].x = 0; for (let i = 0; i < 7; i++) updateInteractives()");
  assert.equal(run("wallShake"), 0);
  assert.equal(run("lowerWalls[0].shown"), 1);
});

test("al soltar el boton se pausa la fase y continua al volver a pisarlo", () => {
  const run = setup();
  run("updateInteractives(); for (let i = 0; i < 10; i++) updateInteractives(); players[0].x = 0");
  run("for (let i = 0; i < 40; i++) updateInteractives()");
  assert.equal(run("lowerWalls[0].shown"), 1);
  assert.equal(run("lowerWalls[0].timer"), 14);
  run("players[0].x = 28 << 8; for (let i = 0; i < 13; i++) updateInteractives()");
  assert.equal(run("lowerWalls[0].shown"), 1);
  run("updateInteractives()");
  assert.equal(run("lowerWalls[0].shown"), 2);
  assert.equal(run("wallShake"), 6);
});

test("la camara permanece fija durante toda la vibracion y retoma el seguimiento al terminar", () => {
  const run = setupCamera();
  for (let tick = 0; tick < 6; tick++) {
    run("update()");
    assert.equal(run("wallShake"), 6 - tick);
    assert.equal(run("cam.x"), 40);
    assert.equal(run("cam.y"), 40);
  }
  assert.equal(run("players[0].x >> 8"), 34);
  assert.equal(run("players[0].y >> 8"), 28);
  run("update()");
  assert.equal(run("wallShake"), 0);
  assert.equal(run("cam.x"), 30);
  assert.equal(run("cam.y"), 30);
  run("update()");
  assert.equal(run("cam.x"), 23);
  assert.equal(run("cam.y"), 23);
});

test("el seguimiento de dos jugadores se congela y reanuda con su punto medio", () => {
  const run = setupCamera();
  run(`
    players.push({ active: true, hp: 4, x: 280 << 8, y: 200 << 8, shield: 0 });
    wallShake = 1;
    updateCamera(players);
  `);
  assert.equal(run("cam.x"), 40);
  assert.equal(run("cam.y"), 40);
  run("wallShake = 0; updateCamera(players)");
  assert.equal(run("cam.x"), 50);
  assert.equal(run("cam.y"), 45);
});
