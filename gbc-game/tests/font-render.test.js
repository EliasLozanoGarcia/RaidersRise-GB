"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function setup() {
  const context = vm.createContext({
    PICKUP: { coin: 1, heart: 2 },
    assets: { fontImage: { width: 64, height: 96 } },
    document: {
      createElement() {
        const canvas = { width: 0, height: 0 };
        const pixels = new Uint8ClampedArray(64 * 104 * 4);
        const ctx = {
          drawImage() {},
          fillRect(x, y, width, height) {
            for (let py = y; py < y + height; py++) {
              for (let px = x; px < x + width; px++) pixels[(py * 64 + px) * 4 + 3] = 255;
            }
          },
          getImageData() { return { data: new Uint8ClampedArray(pixels) }; },
          clearRect() {},
        };
        canvas.getContext = () => ctx;
        return canvas;
      },
    },
  });
  const source = fs.readFileSync(path.join(__dirname, "..", "js", "render.js"), "utf8");
  vm.runInContext(source, context);
  vm.runInContext(`
    assets.fontImage = { width: 64, height: 96 };
    const originalCreateElement = document.createElement;
    document.createElement = () => {
      const canvas = originalCreateElement();
      const getContext = canvas.getContext;
      canvas.getContext = () => {
        const ctx = getContext();
        const originalGetImageData = ctx.getImageData;
        ctx.getImageData = (...args) => {
          const imageData = originalGetImageData(...args);
          for (let y = 65; y < 72; y++) {
            for (let x = 0; x < 3; x++) imageData.data[(y * 64 + x) * 4 + 3] = 255;
          }
          return imageData;
        };
        return ctx;
      };
      return canvas;
    };
    initText();
  `, context);
  return (expression) => vm.runInContext(expression, context);
}

test("la ñ usa el glifo de la celda solitaria y se conserva al normalizar texto", () => {
  const run = setup();
  assert.equal(run("fontGlyphs['ñ'].sy"), 64);
  assert.equal(run("fontGlyphs['ñ'].w"), 3);
  assert.equal(run("textNorm('n\\u0303')"), "ñ");
  assert.equal(run("textNorm('á')"), "a");
});

test("los glifos auxiliares siguen leyéndose de la fila añadida al canvas", () => {
  const run = setup();
  assert.equal(run("fontGlyphs['/'].sy"), 96);
  assert.equal(run("fontGlyphs['©'].sy"), 96);
});
