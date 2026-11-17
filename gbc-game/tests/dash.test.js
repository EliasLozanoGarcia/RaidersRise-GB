"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function setup(character, facing) {
  const context = vm.createContext({ console });
  vm.runInContext(`
    const CFG = { teleportCooldown: 40 };
    const BTN = { UP: 1, DOWN: 2, LEFT: 4, RIGHT: 8, A: 16, B: 32 };
    const DIRS = [[-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1]];
    const DIR_INDEX = [];
    DIRS.forEach((d, i) => { DIR_INDEX[(d[1] + 1) * 3 + d[0] + 1] = i; });
    const PBOX = {};
    const input = { held: [0], pressed: [BTN.B] };
    let frame = 0, blocked = false;
    function unstickPlayer() {}
    function sfx() {}
    function tryMove(p, dx, dy) {
      if (blocked || (!dx && !dy)) return false;
      p.x += dx;
      p.y += dy;
      return true;
    }
  `, context);
  for (const file of ["upgrades.js", "entities.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", file), "utf8"), context);
  }
  vm.runInContext(`
    collectPlayerPickups = () => {};
    const player = { id: 0, ch: CHARS[${character}], x: 0, y: 0, facing: ${facing},
      active: true, hp: 1, tpCooldown: 0, inv: 0 };
    updatePlayer(player);
    input.pressed[0] = 0;
  `, context);
  return (code) => vm.runInContext(code, context);
}

for (const character of [1, 2]) {
  test(`dash del personaje ${character} dura 60 frames a la mitad de velocidad`, () => {
    const run = setup(character, 5);
    run("updatePlayer(player)");
    assert.equal(run("player.x"), 4 * (205 >> 1));
    run("for (let i = 1; i < 59; i++) updatePlayer(player)");
    assert.equal(run("player.dash !== null"), true);
    run("updatePlayer(player)");
    assert.equal(run("player.dash"), null);
    assert.equal(run("player.x"), 60 * 4 * (205 >> 1));
  });

  test(`el personaje ${character} puede dirigir el dash incluso al apuntar`, () => {
    const run = setup(character, 5);
    run("input.held[0] = BTN.UP | BTN.A; updatePlayer(player)");
    assert.equal(run("player.x"), 0);
    assert.equal(run("player.y"), -4 * (205 >> 1));
    assert.equal(run("player.facing"), 5);
    run("input.held[0] = BTN.LEFT | BTN.DOWN; updatePlayer(player)");
    assert.equal(run("player.x"), -4 * (144 >> 1));
    assert.equal(run("player.y"), -4 * (205 >> 1) + 4 * (144 >> 1));
    run("input.held[0] = 0; updatePlayer(player)");
    assert.equal(run("player.x"), -8 * (144 >> 1));
    assert.equal(run("player.y"), -4 * (205 >> 1) + 8 * (144 >> 1));
    assert.equal(run("player.dash.left"), 228);
  });
}

test("dash diagonal reduce ambos ejes a la mitad y se detiene al chocar", () => {
  const run = setup(1, 6);
  run("updatePlayer(player)");
  assert.equal(run("player.x"), 4 * (144 >> 1));
  assert.equal(run("player.y"), 4 * (144 >> 1));
  run("blocked = true; updatePlayer(player)");
  assert.equal(run("player.dash"), null);
});
