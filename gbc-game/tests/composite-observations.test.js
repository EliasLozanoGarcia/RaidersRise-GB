"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { createServer } = require("../tools/composite-server");

test("registra las capas realmente dibujadas en composites normales y especiales", () => {
  const context = vm.createContext({ console });
  vm.runInContext(`
    const recorded = [], failures = [];
    const window = { CompositeRecorder: { record: c => recorded.push(c), fail: e => failures.push(e) } };
    const canvasContext = { save() {}, restore() {}, translate() {}, scale() {}, drawImage() {},
      clearRect() {}, beginPath() {}, rect() {}, clip() {} };
    const document = { createElement: () => ({ getContext: () => canvasContext }) };
    const urban = {}, desert = {}, snow = {}, pickups = {};
    const assets = { biomeTilesets: [urban, desert, snow], tilesetImage: desert, pickupTileset: pickups };
    const hitImages = { tileset: {}, transparentTileset: {}, luckyTileset: {}, pickups: {} };
    let MAP_W = 3, MAP_H = 3;
  `, context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "tiles.js"), "utf8"), context);
  vm.runInContext(`
    fondoLayer = [49, 49, 49, 49, 64, 49, 49, 49, 49];
    fondoAttrs = Array(9).fill(0);
    fondoAttrs[4] = 32;
    itemsLayer = Array(9).fill(-1);
    itemsAttrs = Array(9).fill(0);
    itemsLayer[4] = PICKUP.coin;
    itemsAttrs[4] = 64;
    compCtx = canvasContext; compFree.push(3);
    transparentTilesetImage = {};
    transparentTiles.add(64);
    setComposite(4, -1);
    coinAnim.set(4, { fall: true });
    buildSpecialComposite(4, 156, 0, assets.tilesetImage, urban);
    drawSpecialComposite(canvasContext, 4, 124, 32, 0, 0);
  `, context);
  const actual = JSON.parse(vm.runInContext("JSON.stringify(recorded)", context));
  assert.deepEqual(actual[0], { biome: "desert", kind: "normal", layers: [
    { source: "desert", tile: 49, attr: 0, x: 0, y: 0 },
    { source: "biome-transparent", tile: 64, attr: 32, x: 0, y: 0 },
    { source: "pickups", tile: 153, attr: 64, x: 0, y: -1 }
  ] });
  assert.deepEqual(actual[1].layers.map(layer => [layer.source, layer.tile, layer.y]),
    [["urban", 156, 0], ["biome-transparent", 64, 0], ["pickups", 153, -1]]);
  assert.deepEqual(actual[2].layers.map(layer => layer.tile), [124, 64, 153]);
  assert.equal(actual[2].kind, "special-fallback");
  assert.equal(vm.runInContext("failures.length", context), 0);
});

test("fusiona, deduplica y conserva las observaciones sin limite de 1024", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "raiders-composites-"));
  const file = path.join(dir, "observations.json");
  fs.writeFileSync(file, JSON.stringify({ version: 1, combinations: [] }));
  t.after(() => { fs.unlinkSync(file); fs.rmdirSync(dir); });
  const server = createServer(dir, file);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = `http://127.0.0.1:${server.address().port}`;
  const post = (entries, headers = {}) => fetch(`${address}/__composite_observations`, {
    method: "POST", headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ combinations: entries })
  });
  const entries = Array.from({ length: 1025 }, (_, i) => ({
    biome: "urban", kind: "normal",
    layers: [{ source: "urban", tile: i % 256, attr: 0, x: 0, y: 0 },
      { source: "pickups", tile: Math.floor(i / 256), attr: 0, x: 0, y: 0 }]
  }));
  try {
    for (let i = 0; i < entries.length; i += 256) {
      const response = await post(entries.slice(i, i + 256));
      assert.equal(response.status, 200);
    }
    assert.equal((await (await post([entries[0]])).json()).count, 1025);
    assert.equal((await post([{ ...entries[0], layers: [{ source: "bad" }] }])).status, 400);
    assert.equal((await post([entries[0]], { Origin: "http://example.com" })).status, 403);
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).combinations.length, 1025);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
  const restarted = createServer(dir, file);
  await new Promise(resolve => restarted.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${restarted.address().port}/__composite_observations`);
    assert.equal((await response.json()).count, 1025);
  } finally {
    await new Promise(resolve => restarted.close(resolve));
  }
});
