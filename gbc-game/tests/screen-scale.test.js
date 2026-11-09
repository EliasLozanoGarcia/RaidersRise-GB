"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("el selector actualiza la escala sin interceptar los controles del juego", () => {
  const handlers = {};
  const selector = { value: "auto", addEventListener(name, handler) { handlers[name] = handler; } };
  const screen = { dataset: {}, width: 160, height: 144 };
  const document = { getElementById(id) { return id === "screen-scale" ? selector : screen; } };
  const context = vm.createContext({ document });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "screen-scale.js"), "utf8"), context);

  for (const value of ["1", "2", "3", "4", "auto"]) {
    selector.value = value;
    handlers.change();
    assert.equal(screen.dataset.scale, value);
    assert.equal(screen.width, 160);
    assert.equal(screen.height, 144);
  }
  for (const name of ["keydown", "keyup"]) {
    let stopped = false;
    handlers[name]({ stopPropagation() { stopped = true; } });
    assert.equal(stopped, true);
  }
});
