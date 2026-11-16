"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function createInput(gamepads = []) {
  const listeners = {};
  const context = vm.createContext({
    window: {
      addEventListener(type, listener) { listeners[type] = listener; },
    },
    navigator: { getGamepads: () => gamepads },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "engine", "input.js"), "utf8"), context);
  const input = vm.runInContext("new window.Input()", context);
  return { input, listeners, BTN: vm.runInContext("window.BTN", context) };
}

test("R es SELECT del teclado y Tab deja de activarlo", () => {
  const { input, listeners, BTN } = createInput();
  listeners.keydown({ code: "KeyR", preventDefault() {} });
  input.poll();
  assert.equal(input.held[0] & BTN.SELECT, BTN.SELECT);

  listeners.keyup({ code: "KeyR", preventDefault() {} });
  listeners.keydown({ code: "Tab", preventDefault() {} });
  input.poll();
  assert.equal(input.held[0] & BTN.SELECT, 0);
});

test("Y es SELECT del mando y ya no activa B", () => {
  const buttons = Array.from({ length: 10 }, () => ({ pressed: false }));
  buttons[3].pressed = true;
  const { input, BTN } = createInput([{ connected: true, buttons, axes: [0, 0] }]);
  input.poll();
  assert.equal(input.held[0] & BTN.SELECT, BTN.SELECT);
  assert.equal(input.held[0] & BTN.B, 0);
});
