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
