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
    const input = { pressed: [0, 0] };
    const settings = { lang: 0 };
    const CHARS = [{ name: "KATHY" }, { name: "KURT" }, { name: "SKREEK" }];
    const chars = [0, 1], players = [{ active: true }, { active: false }];
    const GBC_W = 160, GBC_H = 144;
    const assets = { splashMap: { tiles: [], cols: 16, w: 20 }, qrImage: {} };
    let frame = 0;
    const calls = [];
    const ctx = { fillRect(...args) { calls.push(args); }, drawImage() {} };
    function rand16() {}
    function sfx() {}
    function resetGame() { players[1].active = false; }
    function textWidth(s) { return s.length * 4; }
    function drawTextCentered() {}
    function drawText() {}
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

test("About permite navegar al QR y volver a la splash", () => {
  const run = setup();
  run("menuSel = 3; input.pressed = [BTN.A, 0]; updateMenu()");
  assert.equal(run("screen"), "about");
  run("input.pressed = [BTN.RIGHT, 0]; updateMenu()");
  assert.equal(run("aboutPage"), 1);
  run("input.pressed = [BTN.B, 0]; updateMenu()");
  assert.equal(run("screen"), "splash");
});
