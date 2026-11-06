"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function setup(open = true) {
  const context = vm.createContext({ window: {}, console });
  vm.runInContext(`
    const MAP_W = 20, MAP_H = 16, VIEW_H = 120;
    const cam = { x: 0, y: 0 };
    const PBOX = { x: 4, y: 10, w: 8, h: 6 };
    const BTN = { UP: 1, DOWN: 2, LEFT: 4, RIGHT: 8 };
    const DIRS = [[-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1]];
    const DIR_INDEX = [];
    DIRS.forEach((d, i) => { DIR_INDEX[(d[1] + 1) * 3 + d[0] + 1] = i; });
    const CFG = { nudgePixels: 3 };
    const input = { held: [0, 0] };
    const players = [{ id: 0, x: 20 << 8, y: 34 << 8, active: true, hp: 4 }];
    const enemies = [];
    function overlap(ax, ay, a, bx, by, b) {
      return ax + a.x < bx + b.x + b.w && ax + a.x + a.w > bx + b.x &&
        ay + a.y < by + b.y + b.h && ay + a.y + a.h > by + b.y;
    }
  `, context);
  for (const file of ["tiles.js", "physics.js", "interactives.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", file), "utf8"), context);
  }
  vm.runInContext(`
    itemsLayer = Array(MAP_W * MAP_H).fill(-1);
    fondoLayer = Array(MAP_W * MAP_H).fill(49);
    itemsAttrs = Array(MAP_W * MAP_H).fill(0);
    fondoAttrs = Array(MAP_W * MAP_H).fill(0);
    setItemTile = (idx, tile, attr = 0) => { itemsLayer[idx] = tile; itemsAttrs[idx] = attr; };
    const tx = 4, ty = 6, openTopY = 4;
    const cells = [124, 125, 126, 144, 145, 146];
    const tiles = [64, 65, 64, 96, 97, 96];
    const attrs = [0, 0, 32, 0, 0, 32];
    const openTiles = [84, 104, 124], openIds = [72, 71, 70];
    doors = [{ tx, ty, width: 3, openTopY, cells, tiles, attrs, openTiles, openIds,
      openAttrs: [0, 0, 0], pushTime: 0, open: ${open} }];
    if (${open}) openTiles.forEach((idx, i) => setItemTile(idx, openIds[i]));
    else cells.forEach((idx, i) => setItemTile(idx, tiles[i], attrs[i]));
  `, context);
  return (code) => vm.runInContext(code, context);
}

test("puerta abierta solo se empuja desde la izquierda hacia la derecha", () => {
  const run = setup();
  for (const [x, y, held] of [[32, 34, 4], [28, 17, 2], [28, 40, 1], [20, 34, 9], [22, 34, 8]]) {
    run(`players[0].x = ${x} << 8; players[0].y = ${y} << 8; input.held[0] = ${held}; updateInteractives()`);
    assert.equal(run("doors[0].closeTime || 0"), 0);
    assert.equal(run("players[0].pushing"), false);
  }
  run("players[0].x = 20 << 8; players[0].y = 34 << 8; input.held[0] = BTN.RIGHT; updateInteractives()");
  assert.equal(run("doors[0].closeTime"), 1);
  assert.equal(run("players[0].pushAnim"), "right");
});

test("puerta abierta desplaza al jugador una vez al aplicar el offset y reinicia al soltar", () => {
  const run = setup();
  run("input.held[0] = BTN.RIGHT; for (let i = 0; i < 23; i++) updateInteractives()");
  assert.equal(run("players[0].x >> 8"), 20);
  assert.equal(run("tileOffX.has(84)"), false);
  run("updateInteractives()");
  assert.equal(run("players[0].x >> 8"), 21);
  assert.equal(run("tileOffX.get(84)"), 2);
  assert.equal(run("unstickPlayer(players[0], false)"), false);
  assert.equal(run("players[0].x >> 8"), 21);
  run("updateInteractives()");
  assert.equal(run("players[0].x >> 8"), 21);
  run("input.held[0] = 0; updateInteractives()");
  assert.equal(run("doors[0].closeTime"), 0);
  assert.equal(run("tileOffX.has(84)"), false);
});

test("puerta cerrada desplaza al jugador una vez hacia arriba al aplicar el offset", () => {
  const run = setup(false);
  run("players[0].x = 40 << 8; players[0].y = 48 << 8; input.held[0] = BTN.UP");
  run("for (let i = 0; i < 23; i++) updateInteractives()");
  assert.equal(run("players[0].y >> 8"), 48);
  run("updateInteractives()");
  assert.equal(run("players[0].y >> 8"), 47);
  assert.equal(run("tileOffY.get(125)"), -1);
  assert.equal(run("unstickPlayer(players[0], false)"), false);
  assert.equal(run("players[0].y >> 8"), 47);
  run("updateInteractives()");
  assert.equal(run("players[0].y >> 8"), 47);
});

test("el desplazamiento no mete al jugador en una colision solida", () => {
  const run = setup(false);
  run(`
    players[0].x = 40 << 8; players[0].y = 48 << 8; input.held[0] = BTN.UP;
    fondoLayer[7 * MAP_W + 5] = 0;
    for (let i = 0; i < 24; i++) updateInteractives();
  `);
  assert.equal(run("players[0].y >> 8"), 48);
  assert.equal(run("tileOffY.get(125)"), -1);
});
