"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function setup(failingImage) {
  const imageRequests = [], decodes = [];
  const context = vm.createContext({
    window: {},
    console,
    fetch: async (url, options) => {
      if (url.endsWith(".png")) {
        imageRequests.push({ url, options });
        return { ok: true, blob: async () => ({ url }) };
      }
      if (url === "maps/splash.json") return { ok: true, json: async () => ({}) };
      if (url === "maps/Level0-1_Fondo.csv" || url === "maps/Level0-1_Items.csv")
        return { ok: true, text: async () => "0" };
      if (url === "maps/Level0-1_Logic.json") return { ok: true, json: async () => ({}) };
      return { ok: false, status: 404 };
    },
    createImageBitmap: async (blob, options) => {
      decodes.push({ url: blob.url, options });
      if (blob.url === failingImage) throw new Error("PNG invalido");
      return { url: blob.url };
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "loader_dmg.js"), "utf8"), context);
  return { loader: context.window.DMGLoader, imageRequests, decodes };
}

test("las imagenes se cargan sin cache ni conversion del perfil de color", async () => {
  const { loader, imageRequests, decodes } = setup();
  const assets = await loader.init();
  assert.equal(assets.tilesetImage.url, "assets/tileset_GBC_Urban.png");
  assert.ok(imageRequests.length > 0);
  assert.equal(decodes.length, imageRequests.length);
  assert.ok(imageRequests.every(({ options }) => options.cache === "no-store"));
  assert.ok(decodes.every(({ options }) => options.colorSpaceConversion === "none"));
});

test("un fallo de decodificacion de una imagen necesaria se comunica", async () => {
  const { loader } = setup("assets/tileset_GBC_Urban.png");
  await assert.rejects(loader.init(), /tileset_GBC_Urban\.png: PNG invalido/);
});
