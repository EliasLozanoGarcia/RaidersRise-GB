"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { createServer } = require("../tools/composite-server");

test("cada receta reproduce exactamente su tile con el espejo asignado", () => {
  const root = path.join(__dirname, "..");
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "maps", "composite-tiles.json")));
  const expanded = fs.readFileSync(path.join(root, "assets", "composite-tiles.2bpp"));
  const compact = fs.readFileSync(path.join(root, "assets", "composite-unique.2bpp"));
  const reverse = byte => parseInt(byte.toString(2).padStart(8, "0").split("").reverse().join(""), 2);
  assert.equal(compact.length, manifest.uniqueCount * 16);
  for (const tile of manifest.tiles) {
    const data = compact.subarray(tile.unique * 16, tile.unique * 16 + 16);
    for (let y = 0; y < 8; y++) for (let plane = 0; plane < 2; plane++) {
      const source = data[(tile.flip & 64 ? 7 - y : y) * 2 + plane];
      assert.equal(tile.flip & 32 ? reverse(source) : source, expanded[tile.offset + y * 2 + plane],
        `Tile ${tile.id}, fila ${y}, plano ${plane}`);
    }
  }
});

test("las combinaciones Urban comunicadas estan disponibles con todos sus espejos", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "maps", "composite-tiles.json")));
  const recipes = new Set(manifest.tiles.map(tile => JSON.stringify(tile.recipe)));
  for (const [floor, item, source] of [[47, 154, "pickups"], [39, 29, "urban"]]) {
    for (const floorAttr of [0, 32, 64, 96]) for (const itemAttr of [0, 32, 64, 96]) {
      const recipe = { biome: "urban", kind: "normal", layers: [
        { source: "urban", tile: floor, attr: floorAttr, x: 0, y: 0 },
        { source, tile: item, attr: itemAttr, x: 0, y: 0 }
      ] };
      assert.ok(recipes.has(JSON.stringify(recipe)), `${floor}+${item}, ${floorAttr}/${itemAttr}`);
    }
  }
});

test("carga los tiles pregenerados y registra una receta desconocida solo una vez", async () => {
  const root = path.join(__dirname, "..");
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "maps", "composite-tiles.json")));
  const recorded = [], status = {};
  const context = vm.createContext({
    window: { CompositeRecorder: { record: entry => recorded.push(entry) } },
    document: { getElementById: () => status },
    crypto: require("node:crypto").webcrypto,
    TextDecoder, Blob, Uint8Array,
    fetch: async url => {
      const data = fs.readFileSync(path.join(root, ...url.split("/")));
      return { ok: true, arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) };
    },
    createImageBitmap: async () => ({
      width: manifest.columns * 8,
      height: Math.ceil((manifest.uniqueCount + 1) / manifest.columns) * 8
    })
  });
  vm.runInContext(fs.readFileSync(path.join(root, "js", "composite-tiles.js"), "utf8"), context);
  await context.window.CompositeTiles.load();
  const known = manifest.tiles.find(tile => tile.flip !== 0);
  const result = context.window.CompositeTiles.resolve(known.recipe);
  assert.equal(result.index, known.unique);
  assert.equal(result.flip, known.flip);
  const unknown = { ...known.recipe, kind: "special-fallback" };
  const marker = context.window.CompositeTiles.resolve(unknown);
  context.window.CompositeTiles.resolve(unknown);
  assert.equal(marker.index, manifest.uniqueCount);
  assert.deepEqual(Array.from(marker.bytes), [85, 85, 170, 170, 85, 85, 170, 170, 85, 85, 170, 170, 85, 85, 170, 170]);
  assert.equal(recorded.length, 1);
  assert.match(status.textContent, /Tiles nuevos sin generar: 1/);
});

test("conserva los pendientes si el servidor falla y los reenvia al reconectar", async () => {
  let saved = null, timer, online = false;
  const status = {};
  const storage = {
    getItem: () => saved,
    setItem: (_, value) => { saved = value; }
  };
  const context = vm.createContext({
    console: { error() {} },
    document: { getElementById: () => status },
    window: { addEventListener() {} },
    navigator: {},
    localStorage: storage,
    setTimeout: fn => { timer = fn; return 1; },
    fetch: async () => {
      if (!online) throw new Error("sin conexion");
      return { ok: true, json: async () => ({ count: 1 }) };
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "composite-recorder.js"), "utf8"), context);
  vm.runInContext('window.CompositeRecorder.record({biome:"urban",kind:"normal",layers:[{source:"urban",tile:49,attr:0,x:0,y:0}]})', context);
  await timer();
  assert.equal(JSON.parse(saved).length, 1);
  assert.match(status.textContent, /pendientes: 1/);
  online = true;
  await timer();
  assert.equal(JSON.parse(saved).length, 0);
  assert.match(status.textContent, /registradas: 1/);
});

test("si falla el almacenamiento local, envia igualmente los datos en memoria", async () => {
  let timer, sent = 0;
  const status = {};
  const context = vm.createContext({
    console: { error() {} },
    document: { getElementById: () => status },
    window: { addEventListener() {} },
    navigator: {},
    localStorage: { getItem: () => null, setItem: () => { throw new Error("cuota"); } },
    setTimeout: fn => { timer = fn; return 1; },
    fetch: async (_, options) => {
      sent = JSON.parse(options.body).combinations.length;
      return { ok: true, json: async () => ({ count: sent }) };
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "composite-recorder.js"), "utf8"), context);
  vm.runInContext('window.CompositeRecorder.record({biome:"urban",kind:"normal",layers:[{source:"urban",tile:49,attr:0,x:0,y:0}]})', context);
  await timer();
  assert.equal(sent, 1);
  assert.match(status.textContent, /Error/);
});

test("registra las capas realmente dibujadas en composites normales y especiales", () => {
  const context = vm.createContext({ console });
  vm.runInContext(`
    const recorded = [], failures = [];
    const window = { CompositeTiles: {
      resolve: c => { recorded.push(c); return { flip: 0, bytes: new Uint8Array(16) }; },
      draw() {}
    } };
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
    { source: "biome-transparent", tile: 64, attr: 32, x: 0, y: 0 }
  ] });
  assert.deepEqual(actual[1].layers.map(layer => [layer.source, layer.tile, layer.y]),
    [["urban", 156, 0], ["biome-transparent", 64, 0]]);
  assert.deepEqual(actual[2].layers.map(layer => layer.tile), [124, 64]);
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
    const badHostStatus = await new Promise((resolve, reject) => {
      http.get(`${address}/__composite_observations`, { headers: { Host: "example.com" } },
        response => { response.resume(); resolve(response.statusCode); }).on("error", reject);
    });
    assert.equal(badHostStatus, 403);
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
