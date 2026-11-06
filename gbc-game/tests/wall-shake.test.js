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

test("cada fase del muro inicia una vibracion breve", () => {
  const run = setup();
  run("updateInteractives()");
  assert.equal(run("wallShake"), 6);
  assert.equal(run("lowerWalls[0].shown"), 1);
  run("for (let i = 0; i < 6; i++) updateInteractives()");
  assert.equal(run("wallShake"), 0);
  assert.equal(run("lowerWalls[0].shown"), 1);
  run("for (let i = 0; i < 7; i++) updateInteractives()");
  assert.equal(run("lowerWalls[0].shown"), 2);
  assert.equal(run("wallShake"), 6);
});

test("al soltar el boton la vibracion termina y no se reinicia", () => {
  const run = setup();
  run("updateInteractives(); players[0].x = 0; for (let i = 0; i < 7; i++) updateInteractives()");
  assert.equal(run("wallShake"), 0);
  assert.equal(run("lowerWalls[0].shown"), 1);
});
