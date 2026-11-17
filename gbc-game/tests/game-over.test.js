"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function load(context, file, beforeStart = false) {
  const source = fs.readFileSync(path.join(__dirname, "..", "js", file), "utf8");
  vm.runInContext(beforeStart ? source.slice(0, source.indexOf("\nstart().catch")) : source, context);
}

function setupUpdate() {
  const context = vm.createContext({ window: {}, console });
  vm.runInContext(`
    const BTN = { UP: 1, DOWN: 2, A: 16, START: 64 };
    const input = { pressed: [0, 0], held: [0, 0] };
    const PBOX = { x: 0, y: 0, w: 8, h: 8 };
    const CFG = { teleportEffectFrames: 32, enemyDeathFrames: 12, hurtFlash: 6 };
    let screen = "game", shop = null, gameOver = false, paused = false, multiplayer = false;
    let goSel = 0, levelLogic = null, stats = { kills: 7, shots: 9, time: 20 };
    let players = [{ id: 0, active: true, hp: 1, inv: 0, shield: 0, x: 0, y: 0 }];
    let enemies = [], teleportEffects = [], enemyDeathEffects = [];
    const blasts = new Map();
    let shopCalls = 0, spawnUpdates = 0, playerUpdates = 0;
    function overlap() { return true; }
    function sfx() {}
    function invulnFrames() { return 60; }
    function updateSpecialExplosions() {}
    function updateInteractives() {}
    function updateCoins() {}
    function updatePlayer() { playerUpdates++; }
    function updateEnemies() {}
    function updateSpawnPoints() { spawnUpdates++; }
    function openShop() { shopCalls++; shop = {}; }
    function openSelect() { screen = "select"; }
  `, context);
  load(context, "main.js", true);
  vm.runInContext("updateCamera = () => {}; updateBullets = () => {}", context);
  return (code) => vm.runInContext(code, context);
}

test("al morir el ultimo jugador termina la partida y congela las estadisticas", () => {
  const run = setupUpdate();
  run("enemies.push({ x: 0, y: 0, box: PBOX, hp: 1 }); update()");
  assert.equal(run("players[0].hp"), 0);
  assert.equal(run("gameOver"), true);
  assert.equal(run("shopCalls"), 0);
  assert.equal(run("spawnUpdates"), 0);
  assert.equal(run("stats.time"), 21);
  run("update(); update()");
  assert.equal(run("stats.time"), 21);
  assert.equal(run("playerUpdates"), 1);
  assert.equal(run("stats.kills"), 7);
  assert.equal(run("stats.shots"), 9);
});

test("en multijugador la partida sigue hasta que muere el ultimo jugador", () => {
  const run = setupUpdate();
  run(`
    multiplayer = true;
    players.push({ id: 1, active: true, hp: 2, inv: 0, shield: 0, x: 0, y: 0 });
    updateInteractives = () => { players[0].hp = 0; };
    update();
  `);
  assert.equal(run("gameOver"), false);
  assert.equal(run("spawnUpdates"), 1);
  run("players[1].hp = 0; update()");
  assert.equal(run("gameOver"), true);
});

test("la pantalla final permite elegir nueva partida o menu sin continuar la anterior", () => {
  const run = setupUpdate();
  run("gameOver = true; input.pressed[0] = BTN.A; update()");
  assert.equal(run("screen"), "select");
  run("screen = 'game'; input.pressed[0] = BTN.DOWN; update()");
  assert.equal(run("goSel"), 1);
  run("input.pressed[0] = BTN.START; update()");
  assert.equal(run("screen"), "splash");
  assert.equal(run("stats.time"), 20);
});

test("al llegar a la salida no se simula otro frame tras abrir la tienda", () => {
  const run = setupUpdate();
  run("levelLogic = { end: [0, 0, 20, 20] }; update()");
  assert.equal(run("shopCalls"), 1);
  assert.equal(run("playerUpdates"), 0);
  assert.equal(run("spawnUpdates"), 0);
});

test("las estadisticas se conservan al avanzar y se reinician en una partida nueva", () => {
  const context = vm.createContext({ console });
  vm.runInContext(`
    let MAP_W = 20, MAP_H = 20, VIEW_H = 120;
    let assets = { biomeTilesets: [{}] }, hitImages = {}, transparentTilesetImage = {};
    let players = [{ coins: 3, crystals: 2, keys: 1, grenades: 0, active: true },
      { coins: 0, crystals: 0, keys: 0, grenades: 0, active: false }];
    let enemies, bullets, teleportEffects, specialExplosions, enemyDeathEffects;
    let initialItemsLayer, initialItemsAttrs, itemsLayer, itemsAttrs;
    const barrierHp = new Map(), barrierHit = new Map(), tileOffY = new Map(), blasts = new Map();
    const cam = { x: 0, y: 0 };
    let wave, gameOver, goSel, paused, stats = { kills: 12, shots: 25, time: 3600 };
    function shuffle(a) { return a.slice(); }
    function biomeIndex() { return 0; }
    function scanTilesetTransparency() {}
    function makeHitImage() { return {}; }
    function makeLuckyHitImage() { return {}; }
    function syncMapCell() {}
    function newPlayer(i, x, y) { return { id: i, x: x << 8, y: y << 8 }; }
    function initInteractives() {}
    function resetComposites() {}
    function unstickPlayer() {}
    function initSpawnPoints() {}
  `, context);
  load(context, "upgrades.js");
  load(context, "levels.js");
  vm.runInContext(`
    pickLevel = () => {
      initialItemsLayer = Array(MAP_W * MAP_H).fill(-1);
      initialItemsAttrs = Array(MAP_W * MAP_H).fill(0);
    };
    nextLevel();
  `, context);
  const run = (code) => vm.runInContext(code, context);
  assert.equal(run("level"), 2);
  assert.equal(run("JSON.stringify(stats)"), '{"kills":12,"shots":25,"time":3600}');
  assert.equal(run("players[0].coins"), 3);
  run("resetGame()");
  assert.equal(run("level"), 1);
  assert.equal(run("JSON.stringify(stats)"), '{"kills":0,"time":0,"shots":0}');
});

test("la pantalla final muestra el total de niveles y las estadisticas acumuladas", () => {
  const context = vm.createContext({ console });
  vm.runInContext(`
    const PICKUP = { coin: 1, heart: 2, crystal: 3 };
    const GBC_W = 160, VIEW_H = 120;
    const stats = { kills: 12, shots: 25, time: 3600 };
    const level = 4, goSel = 0;
    const players = [{ active: true, coins: 3, crystals: 2 }];
    const drawn = [], ctx = { fillRect() {} };
  `, context);
  load(context, "render.js");
  vm.runInContext(`
    drawText = (ctx, text, x, y) => drawn.push({ text, y });
    drawGlyph = () => {};
    drawGameOver(ctx);
  `, context);
  const drawn = JSON.parse(vm.runInContext("JSON.stringify(drawn)", context));
  const at = (y) => drawn.filter((entry) => entry.y === y).map((entry) => entry.text);
  assert.deepEqual(at(28), ["NIVELES", "3"]);
  assert.deepEqual(at(38), ["BAJAS", "12"]);
  assert.deepEqual(at(48), ["DISPAROS", "25"]);
  assert.deepEqual(at(58), ["TIEMPO", "01M 00S"]);
  assert.ok(drawn.some((entry) => entry.text === "NUEVA PARTIDA"));
  assert.ok(drawn.some((entry) => entry.text === "MENU PRINCIPAL"));
  assert.ok(!drawn.some((entry) => entry.text === "CONTINUAR"));
  vm.runInContext("drawn.length = 0; stats.time = 35838; drawGameOver(ctx)", context);
  const time = JSON.parse(vm.runInContext("JSON.stringify(drawn.filter(e => e.y === 58))", context));
  assert.equal(time[1].text, "10M 00S");
});
