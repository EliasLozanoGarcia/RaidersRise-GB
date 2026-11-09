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
    const BTN = { UP: 1, DOWN: 2, LEFT: 4, RIGHT: 8 };
    const input = { held: [BTN.UP, 0] };
    const DIR_INDEX = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    const itemsLayer = Array(MAP_W * MAP_H).fill(-1);
    const itemsAttrs = Array(MAP_W * MAP_H).fill(0);
    const ALERT_CHEST = 93;
    let level = 1;
    const players = [
      { id: 0, x: 34 << 8, y: 39 << 8, active: true, hp: 4, coins: 0 },
      { id: 1, x: 42 << 8, y: 39 << 8, active: false, hp: 4, coins: 0 }
    ];
    const enemies = [];
    function overlap(ax, ay, a, bx, by, b) {
      return ax + a.x < bx + b.x + b.w && ax + a.x + a.w > bx + b.x &&
        ay + a.y < by + b.y + b.h && ay + a.y + a.h > by + b.y;
    }
    function setItemTile(idx, tile, attr = 0) { itemsLayer[idx] = tile; itemsAttrs[idx] = attr; }
    function getCellCollision() { return 0; }
    function spawnCoins() {}
    function sfx() {}
  `, context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "interactives.js"), "utf8"), context);
  vm.runInContext(`
    coinChests = [
      { tx: 4, ty: 4, pushTime: 0, opened: false },
      { tx: 6, ty: 4, pushTime: 0, opened: false }
    ];
    for (const c of coinChests) {
      for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++)
        setItemTile((c.ty + y) * MAP_W + c.tx + x, y ? 61 : 29);
    }
  `, context);
  return (code) => vm.runInContext(code, context);
}

test("solo avanza y se abre el cofre mas cercano", () => {
  const run = setup();
  run("for (let i = 0; i < 90; i++) updateInteractives()");
  assert.equal(run("coinChests[0].opened"), true);
  assert.equal(run("coinChests[1].opened"), false);
  assert.equal(run("coinChests[1].pushTime"), 0);
  assert.equal(run("players[0].coins"), 5);
  assert.equal(run("itemsLayer[4 * MAP_W + 6]"), 29);
});

test("cambiar de cofre reinicia el progreso y restaura la alerta", () => {
  const run = setup();
  run("for (let i = 0; i < 30; i++) updateInteractives()");
  assert.equal(run("coinChests[0].pushTime"), 30);
  assert.equal(run("itemsLayer[4 * MAP_W + 4]"), 93);
  run("players[0].x = 42 << 8; updateInteractives()");
  assert.equal(run("coinChests[0].pushTime"), 0);
  assert.equal(run("itemsLayer[4 * MAP_W + 4]"), 29);
  assert.equal(run("coinChests[1].pushTime"), 1);
  run("input.held[0] = 0; updateInteractives()");
  assert.equal(run("coinChests[1].pushTime"), 0);
  assert.equal(run("itemsLayer[4 * MAP_W + 6]"), 29);
});

test("dos jugadores pueden abrir cofres distintos independientemente", () => {
  const run = setup();
  run("players[1].active = true; input.held[1] = BTN.UP");
  run("for (let i = 0; i < 90; i++) updateInteractives()");
  assert.equal(run("coinChests[0].opened && coinChests[1].opened"), true);
  assert.equal(run("players[0].coins"), 5);
  assert.equal(run("players[1].coins"), 5);
});

test("un empate elige un solo cofre y respeta los requisitos de empuje", () => {
  const run = setup();
  run("players[0].x = 40 << 8; updateInteractives()");
  assert.equal(run("coinChests[0].pushTime"), 1);
  assert.equal(run("coinChests[1].pushTime"), 0);
  run("input.held[0] = BTN.DOWN; updateInteractives()");
  assert.equal(run("coinChests[0].pushTime + coinChests[1].pushTime"), 0);
  run("input.held[0] = BTN.UP; players[0].active = false; updateInteractives()");
  assert.equal(run("coinChests[0].pushTime + coinChests[1].pushTime"), 0);
});
