"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function setup() {
  const context = vm.createContext({
    console,
    window: {},
    document: {
      getElementById: () => ({ textContent: "" }),
      createElement: () => {
        const cv = { width: 160, height: 144, pixels: null };
        cv.getContext = () => ({
          createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
          getImageData: () => ({ data: cv.pixels || new Uint8ClampedArray(cv.width * cv.height * 4) }),
          putImageData: (img) => { cv.pixels = img.data; },
          drawImage: (img) => { if (img && img.pixels) cv.pixels = img.pixels; },
          clearRect: () => {},
          save: () => {},
          restore: () => {},
          clip: () => {}
        });
        return cv;
      }
    }
  });

  // Load gbc.js
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "engine", "gbc.js"), "utf8"), context);
  vm.runInContext(`
    const GBC = window.GBC, GBC_W = window.GBC_W, GBC_H = window.GBC_H;
    const canvas = document.createElement();
    const gbc = new GBC(canvas);

    // Aseguramos que el ctx de la pantalla no recibe llamadas drawImage/fillRect durante el render GBC
    gbc.ctx.drawImage = () => { throw new Error("gbc.ctx.drawImage no debe ser llamado por el render GBC"); };
    gbc.ctx.fillRect = () => { throw new Error("gbc.ctx.fillRect no debe ser llamado por el render GBC"); };

    const VIEW_H = 120, HUD_H = 24, MAP_W = 20, MAP_H = 16;
    const CFG = { specialCharge: 120, enemyAnimFrames: 14, hurtFlash: 6, maxSprites: 40, maxSpritesPerLine: 10, specialExplosionFrameTicks: 12, enemyTypes: {
      slime: { sprite: "enemyImage", size: 8 }
    }};
    const PICKUP = { heart: 152, coin: 153, mana: 154, crystal: 155, shield: 160, key: 161, grenade: 162 };
    const LUCKY_DROPS = Object.values(PICKUP);
    const FLOOR_COMPOSITE_TILES = new Set([64, 65, 66, 67, 69, 70, 71, 72]);
    let frame = 0, selFrame = -1, screen = "game", gameOver = false, shop = null, paused = false, wallShake = 0, wave = 1;
    const cam = { x: 0, y: 0 };
    let players = [{ id: 0, active: true, hp: 5, mana: 50, coins: 10, crystals: 2, x: 32 << 8, y: 32 << 8, facing: 0, row: 0, inv: 0, hit: 0, ch: { img: "playerImage" } }];
    let enemies = [{ type: "slime", sprite: "enemyImage", size: 8, x: 48 << 8, y: 48 << 8, dir: 0, hp: 2, hit: 0, moving: true, animT: 5 }];
    let bullets = [], luckyBoxes = [], teleportEffects = [], specialExplosions = [], enemyDeathEffects = [];
    const blasts = new Map(), barrierHit = new Map(), tileOffY = new Map(), tileOffX = new Map(), compSlot = new Map();
    const coinWaiting = () => false, fondoClear = () => false, baseFloor = () => 49;
    const specialMarkerCells = () => [];
    const specialFloor = () => false;
    let itemsLayer = new Array(MAP_W * MAP_H).fill(-1);
    let fondoLayer = new Array(MAP_W * MAP_H).fill(49);
    let itemsAttrs = new Array(MAP_W * MAP_H).fill(0);
    let fondoAttrs = new Array(MAP_W * MAP_H).fill(0);

    const palette = [0x7a953a, 0x4b6e1a, 0x0f380f, 0x002204];
    const atlasPixels = new Uint8ClampedArray(256 * 64 * 4);
    for (let i = 0; i < 256 * 64; i++) {
      const color = palette[i % 4], p = i * 4;
      atlasPixels[p] = color >> 16; atlasPixels[p + 1] = (color >> 8) & 255;
      atlasPixels[p + 2] = color & 255; atlasPixels[p + 3] = 255;
    }
    const atlas = { width: 256, height: 64, pixels: atlasPixels };

    function mockImg(w, h, fillVal = 0) {
      const pixels = new Uint8ClampedArray(w * h * 4);
      if (fillVal) pixels.fill(fillVal);
      return { width: w, height: h, pixels };
    }
    const assets = {
      tilesetImage: atlas,
      biomeTilesets: [atlas],
      playerImage: mockImg(144, 96, 100),
      enemyImage: mockImg(64, 16, 100),
      fontImage: mockImg(64, 96, 255),
      pickupTileset: mockImg(256, 64, 100),
      reloadImage: mockImg(8, 8, 100),
      enemyDeathImage: mockImg(8, 8, 100),
      teleportImage: mockImg(128, 16, 100)
    };
  `, context);

  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "physics.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "render.js"), "utf8"), context);
  return (code) => vm.runInContext(code, context);
}

test("render() en modo juego utiliza el mini-PPU sin llamadas a ctx.drawImage ni ctx.fillRect", () => {
  const run = setup();
  run(`
    initEnemyFrameBottoms();
    initHud();
    render();
  `);

  // Comprueba que los registros y las estructuras del hardware GBC estan pobladas
  assert.equal(run("gbc.lcdc.winOn"), true);
  assert.equal(run("gbc.wy"), 120);
  assert.equal(run("gbc.wx"), 7);

  // Paletas RGB555 inicializadas
  assert.equal(run("gbc.bgPal[0] > 0"), true);
  assert.equal(run("gbc.objPal[1] > 0"), true);

  // VRAM poblada
  assert.equal(run("gbc.vram[0].some(b => b !== 0)"), true);
  assert.equal(run("gbc.vram[1].some(b => b !== 0)"), true);

  // Tilemaps poblados
  assert.equal(run("gbc.mapTile[0][0] >= 0"), true);
  assert.equal(run("gbc.mapTile[1].some(t => t !== 0)"), true);

  // OAM contiene sprites activos (jugador 16x16 = 4 sprites, enemigo = 1 sprite)
  const oamUsed = run("gbc.stats.oamUsed");
  assert.ok(oamUsed >= 5, `Se esperaban al menos 5 sprites en OAM, pero hay ${oamUsed}`);
});

test("los menus dibujan el texto en el canvas aunque exista el mini-PPU", () => {
  const run = setup();
  run(`
    screen = "splash";
    assets.textBuffer = {};
    const canvasCalls = [];
    const menuCtx = {
      drawImage(...args) { canvasCalls.push(args); }
    };
    drawGlyph(menuCtx, TEXT_IDS[0], 8, 100);
  `);
  assert.equal(run("canvasCalls.length"), 1);
  assert.equal(run("canvasCalls[0][0] === assets.textBuffer"), true);
});

test("un cambio de tileset recarga los composites y el texto en VRAM", () => {
  const run = setup();
  run(`
    currentLoadedTileset = null;
    assets.tilesetImage = {};
    const sequence = [];
    loadTilesetToVram = () => sequence.push("tileset");
    loadPickupTilesToVram = () => sequence.push("pickups");
    syncAllCompositesToVram = () => sequence.push("composites");
    updateTextBufferVram = () => sequence.push("text");
    ensureTilesetLoaded();
  `);
  assert.equal(run("sequence.join(',')"), "tileset,pickups,composites,text");
});

test("los premios 153-155 se cargan desde el atlas de pickups", () => {
  const run = setup();
  const result = run(`
    assets.pickupTileset = {
      width: 256,
      height: 64,
      pixels: new Uint8ClampedArray(256 * 64 * 4)
    };
    for (let id = 153; id <= 155; id++) {
      const x = (id % 32) * 8, y = (id >> 5) * 8;
      for (let py = 0; py < 8; py++) for (let px = 0; px < 8; px++) {
        const i = ((y + py) * 256 + x + px) * 4;
        assets.pickupTileset.pixels[i] = 0;
        assets.pickupTileset.pixels[i + 1] = 0;
        assets.pickupTileset.pixels[i + 2] = 0;
        assets.pickupTileset.pixels[i + 3] = 255;
      }
    }
    loadPickupTilesToVram();
    [153,154,155].map(id => gbc.vram[0].subarray(id * 16, (id + 1) * 16).some(Boolean))
  `);
  assert.deepEqual(Array.from(result), [true, true, true]);
});

test("los tres colores opacos de un sprite conservan indices distintos", () => {
  const run = setup();
  const result = run(`
    const pixels = new Uint8ClampedArray(8 * 8 * 4);
    const colors = [[122,149,58], [85,116,42], [15,56,15]];
    colors.forEach((color, x) => {
      const i = x * 4;
      pixels[i] = color[0]; pixels[i + 1] = color[1]; pixels[i + 2] = color[2]; pixels[i + 3] = 255;
    });
    const bytes = convert8x8To2bpp(pixels, 8, 0, 0, true);
    colors.map((_, x) => (((bytes[1] >> (7 - x)) & 1) << 1) | ((bytes[0] >> (7 - x)) & 1))
  `);
  assert.deepEqual(Array.from(result), [1, 2, 3]);
});

test("imagenes sin URL conservan sus propios tiles de sprite en la cache", () => {
  const run = setup();
  const result = run(`
    const first = { width: 8, height: 8, pixels: new Uint8ClampedArray(8 * 8 * 4) };
    const second = { width: 8, height: 8, pixels: new Uint8ClampedArray(8 * 8 * 4) };
    for (let i = 0; i < first.pixels.length; i += 4) {
      first.pixels.set([122, 149, 58, 255], i);
      second.pixels.set([15, 56, 15, 255], i);
    }
    const a = getOrCreateSpriteTile(first, 0, 0);
    const b = getOrCreateSpriteTile(second, 0, 0);
    ({ different: a.some((value, i) => value !== b[i]), cached: a === getOrCreateSpriteTile(first, 0, 0) })
  `);
  assert.equal(result.different, true);
  assert.equal(result.cached, true);
});

test("Kathy y Kurt usan sus propios proyectiles en las tres direcciones a la vez", () => {
  const run = setup();
  const result = run(`
    const makeShot = (colors) => {
      const pixels = new Uint8ClampedArray(24 * 8 * 4);
      for (let y = 0; y < 8; y++) for (let x = 0; x < 24; x++)
        pixels.set([...colors[Math.floor(x / 8)], 255], (y * 24 + x) * 4);
      return { width: 24, height: 8, pixels };
    };
    assets.shotBigImage = makeShot([[122,149,58], [85,116,42], [15,56,15]]);
    assets.shotSmallImage = makeShot([[15,56,15], [122,149,58], [85,116,42]]);
    bullets = ["shotBigImage", "shotSmallImage"].flatMap((img, kind) =>
      [0, 1, 2].map(bulletFrame => ({
        img, bulletFrame, mirror: bulletFrame === 1,
        x: (24 + bulletFrame * 16) << 8, y: (60 + kind * 16) << 8
      })));
    initEnemyFrameBottoms();
    initHud();
    render();
    bullets.map(b => {
      const x = (b.x >> 8) - 4 + 8, y = (b.y >> 8) - 4 + 16;
      const offset = Array.from({ length: 40 }, (_, i) => i * 4)
        .find(i => gbc.oam[i] === y && gbc.oam[i + 1] === x);
      if (offset === undefined) return null;
      const tid = gbc.oam[offset + 2], attr = gbc.oam[offset + 3];
      const expected = getOrCreateSpriteTile(assets[b.img], b.bulletFrame * 8, 0);
      return {
        matches: expected.every((value, i) => gbc.vram[1][tid * 16 + i] === value),
        palette: attr & 7, bank: attr & 8, mirror: !!(attr & 0x20)
      };
    })
  `);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), [
    { matches: true, palette: 0, bank: 8, mirror: false },
    { matches: true, palette: 0, bank: 8, mirror: true },
    { matches: true, palette: 0, bank: 8, mirror: false },
    { matches: true, palette: 2, bank: 8, mirror: false },
    { matches: true, palette: 2, bank: 8, mirror: true },
    { matches: true, palette: 2, bank: 8, mirror: false }
  ]);
});

test("el verde medio oscuro de los enemigos no se fusiona con el color oscuro", () => {
  const run = setup();
  const result = run(`
    const pixels = new Uint8ClampedArray(8 * 8 * 4);
    const colors = [[122,149,58], [42,78,25], [15,56,15]];
    colors.forEach((color, x) => {
      const i = x * 4;
      pixels[i] = color[0]; pixels[i + 1] = color[1]; pixels[i + 2] = color[2]; pixels[i + 3] = 255;
    });
    const bytes = convert8x8To2bpp(pixels, 8, 0, 0, true);
    colors.map((_, x) => (((bytes[1] >> (7 - x)) & 1) << 1) | ((bytes[0] >> (7 - x)) & 1))
  `);
  assert.deepEqual(Array.from(result), [1, 2, 3]);
});

test("la paleta oficial de sprites se cuantiza sin umbrales de luminosidad", () => {
  const run = setup();
  const result = run(`
    const pixels = new Uint8ClampedArray(8 * 8 * 4);
    const colors = [[122,149,58], [85,116,42], [15,56,15]];
    colors.forEach((color, x) => {
      const i = x * 4;
      pixels[i] = color[0]; pixels[i + 1] = color[1]; pixels[i + 2] = color[2]; pixels[i + 3] = 255;
    });
    const bytes = convert8x8To2bpp(pixels, 8, 0, 0, true);
    colors.map((_, x) => (((bytes[1] >> (7 - x)) & 1) << 1) | ((bytes[0] >> (7 - x)) & 1))
  `);
  assert.deepEqual(Array.from(result), [1, 2, 3]);
});

test("la conversion de sprites tolera variaciones de color del navegador", () => {
  const run = setup();
  const result = run(`
    const pixels = new Uint8ClampedArray(8 * 8 * 4);
    const colors = [[121,148,57], [84,115,41], [16,55,16]];
    colors.forEach((color, x) => {
      const i = x * 4;
      pixels[i] = color[0]; pixels[i + 1] = color[1]; pixels[i + 2] = color[2]; pixels[i + 3] = 255;
    });
    const bytes = convert8x8To2bpp(pixels, 8, 0, 0, true);
    colors.map((_, x) => (((bytes[1] >> (7 - x)) & 1) << 1) | ((bytes[0] >> (7 - x)) & 1))
  `);
  assert.deepEqual(Array.from(result), [1, 2, 3]);
});

test("los indices de sprite terminan en los tres verdes de OAM, no en negro", () => {
  const run = setup();
  run(`
    setupGBCPalettes();
    const rendered = [
      gbc.objPal[1], gbc.objPal[2], gbc.objPal[3]
    ].map(color => {
      const r = color & 31, g = (color >> 5) & 31, b = (color >> 10) & 31;
      return [(r << 3) | (r >> 2), (g << 3) | (g >> 2), (b << 3) | (b >> 2)];
    });
  `);
  assert.deepEqual(JSON.parse(run("JSON.stringify(rendered)")), [
    [123, 148, 57], [82, 115, 41], [16, 57, 16]
  ]);
});

test("todos los graficos de fondo conservan los cuatro colores del tileset", () => {
  const run = setup();
  const result = run(`
    const pixels = new Uint8ClampedArray(8 * 8 * 4);
    const colors = [[122,149,58], [75,110,26], [36,77,29], [15,56,15]];
    colors.forEach((color, x) => {
      const i = x * 4;
      pixels[i] = color[0]; pixels[i + 1] = color[1]; pixels[i + 2] = color[2]; pixels[i + 3] = 255;
    });
    const bytes = convert8x8To2bpp(pixels, 8, 0, 0, false);
    colors.map((_, x) => (((bytes[1] >> (7 - x)) & 1) << 1) | ((bytes[0] >> (7 - x)) & 1))
  `);
  assert.deepEqual(Array.from(result), [0, 1, 2, 3]);
});

test("los dos tonos oscuros de fondo mantienen contraste visible", () => {
  const run = setup();
  const result = JSON.parse(run(`
    setupGBCPalettes();
    JSON.stringify([gbc.bgPalRgb[2], gbc.bgPalRgb[3]].map(color => {
      return [color & 255, (color >> 8) & 255, (color >> 16) & 255];
    }))
  `));
  const [mediumDark, darkest] = result;
  assert.deepEqual(mediumDark, [42, 78, 25]);
  assert.deepEqual(darkest, [15, 56, 15]);
});

test("el dano aplica la misma paleta a objetos, jugadores y enemigos y luego la restaura", () => {
  const run = setup();
  const result = run(`
    initHud();
    const colors = [[122,149,58], [85,116,42], [42,78,25], [15,56,15]];
    const paint = (image) => {
      for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++)
        image.pixels.set([...colors[x % 4], 255], (y * image.width + x) * 4);
    };
    assets.tilesetImage = mockImg(256, 64);
    paint(assets.tilesetImage);
    paint(assets.playerImage);
    paint(assets.enemyImage);
    initEnemyFrameBottoms();
    itemsLayer[0] = 19;
    barrierHit.set(0, 6);
    players[0].hit = 6;
    enemies[0].hit = 6;
    const row = (x, y) => Array.from({ length: 4 }, (_, n) =>
      Array.from(gbc.image.data.slice((y * GBC_W + x + n) * 4, (y * GBC_W + x + n) * 4 + 3)));
    render();
    const hit = [row(0, 0), row(32, 32), row(48, enemySpriteY(enemies[0]))];
    barrierHit.clear();
    players[0].hit = 0;
    enemies[0].hit = 0;
    render();
    const normal = [row(0, 0), row(32, 32), row(48, enemySpriteY(enemies[0]))];
    ({ hit, normal })
  `);
  const light = [122,149,58], medium = [85,116,42], mediumDark = [42,78,25], dark = [15,56,15];
  assert.deepEqual(JSON.parse(JSON.stringify(result.hit)), Array(3).fill([light, light, medium, mediumDark]));
  assert.deepEqual(JSON.parse(JSON.stringify(result.normal)), [
    [light, medium, mediumDark, dark],
    [light, medium, medium, dark],
    [light, medium, medium, dark]
  ]);
});

test("los tiles, barra, iconos y numeros del HUD conservan los colores del tileset", () => {
  const run = setup();
  const result = run(`
    setupGBCPalettes();
    initHud();
    const colors = [[122,149,58], [85,116,42], [42,78,25], [15,56,15]];
    const pixels = new Uint8ClampedArray(8 * 8 * 4);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      pixels.set([...colors[x % 4], 255], (y * 8 + x) * 4);
    }
    const bytes = convert8x8To2bpp(pixels, 8, 0, 0, false);
    for (const id of [80, 128, PICKUP.heart]) gbc.vram[1].set(bytes, hudTileId(id) * 16);
    gbc.vram[1].set(bytes, HUD_IMAGE_TILES.get(hudTop) * 16);
    drawHudTile(gbc.ctx, 80, 0, VIEW_H);
    drawHudImage(gbc.ctx, hudTop, 0, 0, 8, VIEW_H, 0x20);
    drawGlyph(gbc.ctx, PICKUP.heart, 16, VIEW_H);
    drawHudNumber(gbc.ctx, 1, 24, VIEW_H, 8);
    gbc.lcdc.winOn = true;
    gbc.lcdc.objOn = false;
    gbc.wy = VIEW_H;
    gbc.renderFrame();
    [0, 8, 16, 24].map(start => Array.from({ length: 4 }, (_, x) => {
      const i = ((VIEW_H * GBC_W) + start + x) * 4;
      return Array.from(gbc.image.data.slice(i, i + 3));
    }))
  `);
  const colors = [[122,149,58], [85,116,42], [42,78,25], [15,56,15]];
  assert.deepEqual(JSON.parse(JSON.stringify(result)), [colors, [...colors].reverse(), colors, colors]);
});

test("los tiles del HUD sobreviven a la carga del mapa y sus composites", () => {
  const run = setup();
  const result = run(`
    initHud();
    const hudSlots = [...HUD_TILES.values(), ...HUD_IMAGE_TILES.values()];
    const before = hudSlots.map(id => Array.from(gbc.vram[1].slice(id * 16, (id + 1) * 16)));
    ensureTilesetLoaded();
    compCv = { width: 8, height: 8, pixels: new Uint8ClampedArray(8 * 8 * 4).fill(255) };
    COMP_SLOTS = 96;
    syncAllCompositesToVram();
    assets.tilesetImage = { width: 256, height: 64, pixels: new Uint8ClampedArray(256 * 64 * 4).fill(255) };
    ensureTilesetLoaded();
    hudSlots.every((id, i) => before[i].every((value, j) => gbc.vram[1][id * 16 + j] === value))
  `);
  assert.equal(result, true);
});

test("el fondo del HUD limpia las celdas vacias al reducirse un numero", () => {
  const run = setup();
  run(`
    initHud();
    players[0].coins = 99;
    drawHud(gbc.ctx);
    players[0].coins = 9;
    drawHud(gbc.ctx);
  `);
  assert.equal(run("gbc.mapTile[1][32 + 12]"), run("hudTileId(146)"));
  assert.equal(run("gbc.mapAttr[1][32 + 12]"), 8);
});

test("los composites ignoran una lectura antigua cacheada del canvas", () => {
  const run = setup();
  run(`
    const stale = new Uint8ClampedArray(8 * 8 * 4);
    stale.fill(0);
    const fresh = new Uint8ClampedArray(8 * 8 * 4);
    for (let i = 0; i < fresh.length; i += 4) {
      fresh[i] = 0; fresh[i + 1] = 0; fresh[i + 2] = 0; fresh[i + 3] = 255;
    }
    compCv = { width: 8, height: 8 };
    imagePixelCache.set(compCv, { pixels: stale, width: 8, height: 8 });
    document.createElement = () => {
      const cv = { width: 8, height: 8 };
      cv.getContext = () => ({
        drawImage() {},
        getImageData() { return { data: fresh }; }
      });
      return cv;
    };
    updateCompositeVram(0);
  `);
  assert.equal(run("gbc.vram[0].some((value, index) => index >= 160 * 16 && index < 161 * 16 && value !== 0)"), true);
});

test("el texto usa VRAM banco 1 y no sobrescribe los tiles del mapa", () => {
  const run = setup();
  const result = run(`
    const originalMapTiles = new Uint8Array(gbc.vram[0]);
    assets.textBuffer = { width: 8, height: 8, pixels: new Uint8ClampedArray(8 * 8 * 4) };
    for (let i = 0; i < assets.textBuffer.pixels.length; i += 4) {
      assets.textBuffer.pixels[i] = assets.textBuffer.pixels[i + 1] = assets.textBuffer.pixels[i + 2] = 0;
      assets.textBuffer.pixels[i + 3] = 255;
    }
    updateTextBufferVram();
    screen = "game";
    drawGlyph(gbc.ctx, TEXT_IDS[0], 8, 8);
    ({
      bank0Untouched: originalMapTiles.every((value, index) => gbc.vram[0][index] === value),
      bank1Written: gbc.vram[1].subarray(160 * 16, 161 * 16).some(Boolean),
      bankSelected: (gbc.mapAttr[0][33] & 8) !== 0,
      realTileReserved: !TEXT_IDS.includes(84) && !TEXT_IDS.includes(116)
    })
  `);
  assert.equal(result.bank0Untouched, true);
  assert.equal(result.bank1Written, true);
  assert.equal(result.bankSelected, true);
  assert.equal(result.realTileReserved, true);
});

test("la capa de fondo escribe correctamente los tiles y atributos en mapTile[0]", () => {
  const run = setup();
  run(`
    initEnemyFrameBottoms();
    initHud();
    itemsLayer[0] = 27;
    itemsAttrs[0] = 0x20;
    render();
  `);
  assert.equal(run("gbc.mapTile[0][0]"), 27);
  assert.equal(run("gbc.mapAttr[0][0] & 0x20"), 0x20);
});

test("los overlays usan la capa Window a pantalla completa (wy = 0)", () => {
  const run = setup();
  run(`
    initEnemyFrameBottoms();
    initHud();
    paused = true;
    render();
  `);
  assert.equal(run("gbc.lcdc.winOn"), true);
  assert.equal(run("gbc.wy"), 0);
  assert.equal(run("gbc.wx"), 7);
});
