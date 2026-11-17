"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function setup() {
  const context = vm.createContext({ console });
  vm.runInContext(`
    const CFG = { specialCharge: 100, specialDamage: 1, specialTickFrames: 30,
      specialExplosionFrameTicks: 12, bulletSpeed: 3 * 256, hurtFlash: 6,
      maxSprites: 40, maxSpritesPerLine: 10 };
    const BTN = { SELECT: 128 };
    const input = { pressed: [0, 0] };
    const GBC_W = 160, GBC_H = 144;
    const ctx = { clearRect() {}, fillRect() {}, save() {}, restore() {}, beginPath() {},
      rect() {}, clip() {}, moveTo() {}, lineTo() {}, closePath() {}, translate() {}, scale() {}, drawImage() {} };
    const gbc = { ctx };
    const document = { getElementById() { return {}; } };
    const lv = () => 0, specialSize = () => 3;
    let specialFrames = () => 240;
    const specialDamage = () => 1, manaRegen = () => 1;
    const sounds = [], itemHits = [];
    function sfx(name) { sounds.push(name); }
    function checkBulletHitItems(x, y) { itemHits.push([x, y]); }
    function hitBulletBarrier() {}
    function damageEnemy(e, n) { e.hp -= n; }
    let luckyBoxes = [], barrierHit = new Map(), tileOffX = new Map(), tileOffY = new Map();
    let wallShake = 0, screen = "game", shop = null;
  `, context);
  for (const name of ["utils.js", "state.js", "tiles.js", "physics.js", "entities.js", "render.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", name), "utf8"), context);
  }
  vm.runInContext(`
    MAP_W = 20; MAP_H = 15;
    fondoLayer = Array(MAP_W * MAP_H).fill(49);
    itemsLayer = Array(MAP_W * MAP_H).fill(-1);
    fondoAttrs = Array(MAP_W * MAP_H).fill(0);
    itemsAttrs = Array(MAP_W * MAP_H).fill(0);
    assets = { tilesetImage: {}, pickupTileset: {}, playerImage: {} };
    assets.biomeTilesets = [assets.tilesetImage];
    drawHud = () => {};
    const actualDrawMapTile = drawMapTile;
    const draws = [];
    drawMapTile = (ctx, tx, ty, id, attr, hit, dy, dx, hitImage, image) =>
      draws.push({ tx, ty, id, attr, image });
  `, context);
  return (code) => vm.runInContext(code, context);
}

test("los siete premios usan el atlas propio en los tres biomas, tambien en composites", () => {
  const run = setup();
  run(`
    const urban = {}, desert = {}, snow = {}, hit = {};
    assets.biomeTilesets = [urban, desert, snow];
    const copied = [];
    document.createElement = () => ({
      getContext: () => ({ drawImage: (...args) => copied.push(args) })
    });
    initPickupTiles();
    hitImages.tileset = hit;
    hitImages.pickups = {};
    const drawn = [];
    drawTileInto = (ctx, id, attr, x, y, image) => drawn.push({ id, image });
    compCtx = { clearRect() {}, save() {}, beginPath() {}, rect() {}, clip() {}, restore() {} };
    gbc.mapTile = [Array(300).fill(0)]; gbc.mapAttr = [Array(300).fill(0)];
    for (let i = 95; i >= 0; i--) compFree.push(i);
  `);
  assert.equal(run("copied.length"), 7);
  assert.equal(run("copied.slice(0,4).every(c => c[0] === urban)"), true);
  assert.equal(run("copied.slice(4).every(c => c[0] === desert)"), true);
  assert.equal(run("copied.map(c => (c[2] / 8) * 32 + c[1] / 8).join(',')"), "152,153,154,155,150,151,152");
  assert.equal(run("copied.map(c => (c[6] / 8) * 32 + c[5] / 8).join(',')"), "152,153,154,155,160,161,162");
  for (const biome of ["urban", "desert", "snow"]) for (let i = 0; i < 7; i++) {
    run(`assets.tilesetImage = ${biome}; drawn.length = 0; setItemTile(0, LUCKY_DROPS[${i}])`);
    assert.equal(run("compSlot.has(0) && drawn.at(-1).image === assets.pickupTileset"), true);
    assert.equal(run("gbc.mapTile[0][0] === LUCKY_DROPS[" + i + "]"), true);
    assert.equal(run("getCellCollision(0, 0)"), 0);
    run(`drawn.length = 0; drawItemInto(compCtx, LUCKY_DROPS[${i}], 0, 0, 0, hitImages.tileset)`);
    assert.equal(run("drawn.at(-1).image === hitImages.pickups"), true);
  }
});

test("los nuevos identificadores mantienen los efectos de los siete premios", () => {
  const run = setup();
  run(`
    CFG.shieldFrames = 300;
    const maxHp = () => 10;
    const p = { hp: 1, coins: 0, mana: 0, crystals: 0, shield: 0, keys: 0, grenades: 0 };
    gbc.mapTile = [Array(300).fill(0)]; gbc.mapAttr = [Array(300).fill(0)];
    for (const item of LUCKY_DROPS) { itemsLayer[0] = item; collectPickup(p, 0); }
  `);
  assert.equal(run("[p.hp,p.coins,p.mana,p.crystals,p.shield,p.keys,p.grenades].join(',')"), "2,1,10,1,300,1,1");
  assert.equal(run("itemsLayer[0]"), -1);
});

test("el dash recoge monedas y objetos por el recorrido y respeta las monedas pendientes", () => {
  const run = setup();
  run(`
    BTN.UP = 1; BTN.DOWN = 2; BTN.LEFT = 4; BTN.RIGHT = 8; BTN.A = 16; BTN.B = 32;
    input.held = [0]; input.pressed = [BTN.B];
    CFG.teleportCooldown = 40; CFG.shieldFrames = 300;
    const maxHp = () => 10;
    setItemTile = (idx, tile) => { itemsLayer[idx] = tile; };
    const p = { id: 0, ch: { dash: true }, x: 32 << 8, y: 20 << 8, facing: 5,
      active: true, hp: 5, coins: 0, keys: 0, shield: 0, tpCooldown: 0, inv: 0 };
    itemsLayer[4 * MAP_W + 5] = PICKUP.coin;
    itemsLayer[4 * MAP_W + 6] = PICKUP.key;
    itemsLayer[4 * MAP_W + 7] = PICKUP.coin;
    coinAnim.set(4 * MAP_W + 7, { delay: 10, fall: false });
    updatePlayer(p);
    input.pressed[0] = 0;
    for (let i = 0; i < 10; i++) updatePlayer(p);
  `);
  assert.equal(run("p.coins"), 1);
  assert.equal(run("p.keys"), 1);
  assert.equal(run("itemsLayer[4 * MAP_W + 7]"), run("PICKUP.coin"));
  run("coinAnim.get(4 * MAP_W + 7).fall = true; updatePlayer(p)");
  assert.equal(run("p.coins"), 2);
});

test("las explosiones usan Urban en cada bioma, tambien bajo premios compuestos", () => {
  const run = setup();
  run(`
    const urban = {}, desert = {}, snow = {};
    assets.biomeTilesets = [urban, desert, snow];
    players = [{ id: 0, ch: { ult: "area", img: "playerImage" }, x: 32 << 8, y: 32 << 8,
      facing: 5, row: 0, mana: 100, active: true, hp: 100, shield: 1 }];
    updateSpecial(players[0], BTN.SELECT); updateSpecial(players[0], 0);
  `);
  for (const biome of ["urban", "desert", "snow"]) {
    run(`assets.tilesetImage = ${biome}; draws.length = 0; render()`);
    assert.equal(run("draws.some(d => d.id === 156 && d.image === urban)"), true);
  }
  run(`
    compCtx = {};
    itemsLayer[0] = PICKUP.key;
    const compositeDraws = [];
    drawTileInto = (ctx, id, attr, x, y, image) => compositeDraws.push({ id, image });
    document.createElement = () => ({
      getContext: () => ({ clearRect() {}, save() {}, beginPath() {}, rect() {}, clip() {}, restore() {} })
    });
    drawSpecialTile(ctx, { tx: 0, ty: 0, id: 124, attr: 0 }, 156, 0, false, null, urban);
  `);
  assert.equal(run("compositeDraws[0].id === 156 && compositeDraws[0].image === urban"), true);
  assert.equal(run("compositeDraws[1].image === assets.pickupTileset"), true);
});

test("selecciona extremos, bordes y esquinas volteadas para cada forma", () => {
  const run = setup();
  const tile = (x, y, w, h) => JSON.parse(run(`JSON.stringify(specialMarkerTile(${x},${y},${w},${h}))`));
  assert.deepEqual([tile(0, 0, 3, 1), tile(1, 0, 3, 1), tile(2, 0, 3, 1)],
    [{ id: 90, attr: 0 }, { id: 91, attr: 0 }, { id: 90, attr: 32 }]);
  assert.deepEqual([tile(0, 0, 1, 3), tile(0, 1, 1, 3), tile(0, 2, 1, 3)],
    [{ id: 89, attr: 0 }, { id: 121, attr: 0 }, { id: 89, attr: 64 }]);
  assert.deepEqual([tile(0, 0, 3, 3), tile(2, 0, 3, 3), tile(0, 2, 3, 3), tile(2, 2, 3, 3)],
    [{ id: 122, attr: 0 }, { id: 122, attr: 32 }, { id: 122, attr: 64 }, { id: 122, attr: 96 }]);
  assert.deepEqual([tile(0, 1, 3, 3), tile(2, 1, 3, 3), tile(1, 0, 3, 3), tile(1, 2, 3, 3), tile(1, 1, 3, 3)],
    [{ id: 92, attr: 0 }, { id: 92, attr: 32 }, { id: 123, attr: 0 }, { id: 123, attr: 64 }, { id: 124, attr: 0 }]);
});

test("solo marca celdas dentro del mapa sin colision total ni media en ninguna capa", () => {
  const run = setup();
  run("fondoLayer[1] = 0; itemsLayer[1] = 8; itemsLayer[20] = 0; itemsLayer[21] = 8; fondoLayer[2] = 8");
  assert.equal(run("JSON.stringify(specialMarkerCells({tx:-1,ty:-1,w:4,h:3}).map(c => [c.tx,c.ty]))"),
    "[[0,0],[2,1]]");
});

test("Kathy y Kurt marcan hasta soltar Select, explotan y conservan su dano", () => {
  const run = setup();
  run(`
    players = [{ id: 0, ch: { ult: "burst" }, x: 32 << 8, y: 32 << 8,
      facing: 5, mana: 100, active: true, hp: 10, shield: 0 }];
    updateSpecial(players[0], BTN.SELECT);
    const sp = players[0].sp;
    enemies = [{ x: (sp.tx * 8) << 8, y: (sp.ty * 8) << 8, box: {x:0,y:0,w:8,h:8}, hp: 10 }];
  `);
  assert.equal(run("players[0].sp.state"), "aim");
  assert.equal(run("players[0].sp.w"), 2);
  assert.equal(run("players[0].sp.h"), 5);
  assert.equal(run("enemies[0].hp"), 10);
  run("updateSpecial(players[0], 0)");
  assert.equal(run("enemies[0].hp"), 7);
  assert.equal(run("specialExplosions[0].cells.length"), 10);
  assert.equal(run("players[0].mana"), 0);
  run(`
    players[0].ch.ult = "area"; players[0].sp = null; players[0].mana = 100;
    updateSpecial(players[0], BTN.SELECT);
    enemies[0].x = (players[0].sp.tx * 8) << 8;
    enemies[0].y = (players[0].sp.ty * 8) << 8;
    updateSpecial(players[0], 0);
  `);
  assert.equal(run("enemies[0].hp"), 7);
  run("for (let i = 0; i < 30; i++) updateSpecial(players[0], 0)");
  assert.equal(run("enemies[0].hp"), 6);
  assert.equal(run("specialExplosions.length"), 1);
});

test("las cuatro diagonales generan areas inclinadas con los cuatro bordes y dano coherente", () => {
  for (const ult of ["area", "burst"]) for (const facing of [0, 2, 4, 6]) {
    const run = setup();
    run(`
      const p = { id: 0, ch: { ult: "${ult}" }, x: 64 << 8, y: 48 << 8,
        facing: ${facing}, mana: 100, active: true, hp: 100, shield: 1 };
      players = [p];
      updateSpecial(p, BTN.SELECT);
      const a = p.sp.diagonal;
      const cells = diagonalCells(a);
    `);
    assert.equal(run("!!a"), true);
    assert.equal(run("[0,32,64,96].every(attr => cells.some(c => c.id === 88 && c.attr === attr))"), true);
    assert.equal(run("cells.some(c => c.id === 124)"), true);
    run(`
      const inside = cells.find(c => c.id === 124);
      const corner = { x: Math.floor((a.minU + a.minV) / 2) * 8, y: Math.floor((a.minU - a.maxV) / 2) * 8 };
      enemies = [
        { x: (inside.tx * 8 + 3) << 8, y: (inside.ty * 8 + 3) << 8, box: {x:0,y:0,w:2,h:2}, hp: 10 },
        { x: corner.x << 8, y: corner.y << 8, box: {x:0,y:0,w:1,h:1}, hp: 10 }
      ];
      specialHit(p, p.sp, 3, false);
    `);
    assert.equal(run("enemies[0].hp"), 7);
    assert.equal(run("enemies[1].hp"), 10);
    assert.equal(run("new Set(itemHits.map(v => v.join(','))).size"), run("cells.filter(c => c.tx >= 0 && c.ty >= 0 && c.tx < MAP_W && c.ty < MAP_H).length"));
  }
});

test("los triangulos diagonales y el dano coinciden pixel a pixel", () => {
  const run = setup();
  run(`
    const p = { id: 0, ch: { ult: "area" }, x: 64 << 8, y: 48 << 8, facing: 4, mana: 100 };
    updateSpecial(p, BTN.SELECT);
    const cells = diagonalCells(p.sp.diagonal);
  `);
  assert.equal(run(`
    (() => {
      for (const cell of cells) for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const flippedX = cell.attr & 32 ? 7 - x : x;
        const flippedY = cell.attr & 64 ? 7 - y : y;
        const visible = cell.id === 124 || flippedX + flippedY >= 7;
        const e = { x: (cell.tx * 8 + x) << 8, y: (cell.ty * 8 + y) << 8,
          box: {x:0,y:0,w:1,h:1}, hp: 10 };
        enemies = [e];
        specialHit(p, p.sp, 1, false);
        if ((e.hp < 10) !== visible) return false;
      }
      return true;
    })()
  `), true);
});

test("la explosion de Kurt y el area activa de Kathy conservan la forma diagonal", () => {
  const run = setup();
  run(`
    players = [{ id: 0, ch: { ult: "burst", img: "playerImage" }, x: 64 << 8, y: 48 << 8,
      facing: 4, row: 0, mana: 100, active: true, hp: 100, shield: 1 }];
    updateSpecial(players[0], BTN.SELECT);
    const expected = specialMarkerCells(players[0].sp).map(c => [c.tx,c.ty].join(',')).sort().join(';');
    updateSpecial(players[0], 0);
  `);
  assert.equal(run("specialExplosions[0].cells.map(c => [c.tx,c.ty].join(',')).sort().join(';')"), run("expected"));
  run(`
    players[0].ch.ult = "area"; players[0].sp = null; players[0].mana = 100;
    updateSpecial(players[0], BTN.SELECT); updateSpecial(players[0], 0);
    draws.length = 0; render();
  `);
  assert.equal(run("specialMarkerCells(players[0].sp).every(c => draws.some(d => d.tx === c.tx && d.ty === c.ty && d.id === 156))"), true);
});

test("Skreek anticipa la trayectoria hasta la pared y dispara al soltar", () => {
  const run = setup();
  run(`
    const p = { id: 0, ch: { ult: "beam" }, x: 16 << 8, y: 32 << 8, facing: 5, mana: 100 };
    itemsLayer[5 * MAP_W + 8] = 0;
    updateSpecial(p, BTN.SELECT);
  `);
  assert.equal(run("bullets.length"), 0);
  assert.equal(run("p.sp.cells.some(c => c.tx >= 8)"), false);
  assert.equal(run("p.sp.cells.at(-1).tx"), 7);
  assert.equal(run("p.sp.cells[0].id"), 90);
  assert.equal(run("p.sp.cells.at(-1).attr"), 32);
  assert.equal(run("p.sp.beam.life"), 480 << 8);
  run("const expected = JSON.stringify(p.sp.beam); updateSpecial(p, 0)");
  assert.equal(run("JSON.stringify(bullets[0]) === expected"), true);
  assert.equal(run("p.sp"), null);
  assert.equal(run("p.mana"), 0);
  assert.equal(run("specialExplosions.length"), 0);
});

test("el marcador invertido y diagonal sigue la trayectoria real del proyectil", () => {
  const run = setup();
  run(`
    MAP_W = 160; MAP_H = 160;
    fondoLayer = Array(MAP_W * MAP_H).fill(49);
    itemsLayer = Array(MAP_W * MAP_H).fill(-1);
    const p = { id: 0, ch: { ult: "beam" }, x: 640 << 8, y: 640 << 8, facing: 1, mana: 100 };
    updateSpecial(p, BTN.SELECT);
  `);
  assert.equal(run("p.sp.cells[0].attr"), 32);
  assert.equal(run("p.sp.cells.at(-1).attr"), 0);
  run("p.facing = 2; updateSpecial(p, BTN.SELECT)");
  assert.equal(run("p.sp.cells.every(c => specialFloor(c.tx, c.ty))"), true);
  for (const facing of [0, 2, 4, 6]) {
    run(`p.facing = ${facing}; updateSpecial(p, BTN.SELECT)`);
    assert.equal(run("p.sp.cells.length > 0"), true);
    assert.equal(run("[0,32,64,96].every(attr => p.sp.cells.some(c => c.id === 88 && c.attr === attr))"), true);
  }
});

test("el marcador del proyectil atraviesa la colision media y se detiene ante la total", () => {
  const run = setup();
  run(`
    const p = { id: 0, ch: { ult: "beam" }, x: 16 << 8, y: 32 << 8, facing: 5, mana: 100 };
    itemsLayer[5 * MAP_W + 5] = 8;
    fondoLayer[5 * MAP_W + 7] = 8;
    itemsLayer[5 * MAP_W + 10] = 0;
    updateSpecial(p, BTN.SELECT);
  `);
  assert.equal(run("p.sp.cells.some(c => c.tx === 5 || c.tx === 7)"), false);
  assert.equal(run("p.sp.cells.at(-1).tx"), 9);
  assert.equal(run("p.sp.cells.some(c => c.tx >= 10)"), false);
});

test("los especiales de suelo atraviesan obstaculos rectos y diagonales", () => {
  for (const ult of ["area", "burst"]) for (const tile of [0, 8]) for (const facing of [5, 6]) {
    const run = setup();
    run(`
      const p = { id: 0, ch: { ult: "${ult}", img: "playerImage" }, x: 16 << 8, y: 32 << 8,
        facing: ${facing}, row: 0, mana: 100, active: true, hp: 100, shield: 1 };
      players = [p];
      for (let y = 0; y < MAP_H; y++) itemsLayer[y * MAP_W + 4] = ${tile};
      updateSpecial(p, BTN.SELECT);
      const target = specialMarkerCells(p.sp).find(c => c.tx > 4 && (!p.sp.diagonal || c.id === 124));
    `);
    assert.equal(run("!!target"), true, `${ult}, tile ${tile}, facing ${facing}`);
    run(`
      enemies = [{ x: (target.tx * 8 + 3) << 8, y: (target.ty * 8 + 3) << 8,
        box: {x:0,y:0,w:2,h:2}, hp: 10 }];
      const q = { id: 1, ch: { img: "playerImage" }, active: true, hp: 10, shield: 0,
        x: (target.tx * 8 - 4) << 8, y: (target.ty * 8 - 10) << 8, facing: 5, row: 0 };
      players.push(q);
      updateSpecial(p, 0);
      if (p.ch.ult === "area") for (let i = 0; i < 30; i++) updateSpecial(p, 0);
      const enemyHp = enemies[0].hp;
      enemies = [];
      draws.length = 0;
      render();
    `);
    assert.equal(run("enemyHp"), ult === "area" ? 9 : 7);
    assert.equal(run("q.hp"), ult === "area" ? 9 : 10);
    assert.equal(run("itemHits.filter(([x, y]) => x === target.tx * 8 + 4 && y === target.ty * 8 + 4).length"), 1);
    assert.equal(run("draws.some(c => c.tx === target.tx && c.ty === target.ty && c.id >= 156 && c.id <= 159)"), true);
  }
});

test("el dash protege del dano de especiales rectos y diagonales", () => {
  for (const facing of [5, 6]) {
    const run = setup();
    run(`
      const p = { ch: { ult: "area" }, x: 16 << 8, y: 32 << 8,
        facing: ${facing}, mana: 100, active: true, hp: 10, shield: 1 };
      players = [p];
      updateSpecial(p, BTN.SELECT);
      const target = specialMarkerCells(p.sp)[0];
      const q = { active: true, hp: 10, shield: 0, dash: {},
        x: (target.tx * 8 - 4) << 8, y: (target.ty * 8 - 10) << 8 };
      players.push(q);
      specialHit(p, p.sp, 1, true);
    `);
    assert.equal(run("q.hp"), 10);
    run("q.dash = null; specialHit(p, p.sp, 1, true)");
    assert.equal(run("q.hp"), 9);
  }
});

test("la explosion de la bazuca no dana ni se dibuja detras de una pared", () => {
  const run = setup();
  run(`
    CFG.bulletGroundOffset = 6; CFG.blastFrames = 10;
    const blastRadius = () => 20;
    for (let y = 0; y < MAP_H; y++) itemsLayer[y * MAP_W + 4] = 0;
    enemies = [
      { x: 26 << 8, y: 34 << 8, box: {x:0,y:0,w:2,h:2}, hp: 10 },
      { x: 42 << 8, y: 34 << 8, box: {x:0,y:0,w:2,h:2}, hp: 10 }
    ];
    explode(27, 35);
  `);
  assert.equal(run("enemies[0].hp"), 9);
  assert.equal(run("enemies[1].hp"), 10);
  assert.equal(run("Array.from(blasts.keys()).some(idx => idx % MAP_W > 4)"), false);
});

test("la explosion de la bazuca alcanza enemigos detras de una colision media", () => {
  const run = setup();
  run(`
    CFG.bulletGroundOffset = 6; CFG.blastFrames = 10;
    const blastRadius = () => 20;
    for (let y = 0; y < MAP_H; y++) itemsLayer[y * MAP_W + 4] = 8;
    enemies = [{ x: 42 << 8, y: 34 << 8, box: {x:0,y:0,w:2,h:2}, hp: 10 }];
    explode(27, 35);
  `);
  assert.equal(run("enemies[0].hp"), 9);
  assert.equal(run("Array.from(blasts.keys()).some(idx => idx % MAP_W > 4)"), true);
});

test("la espada no golpea enemigos ni objetos detras de un muro", () => {
  const run = setup();
  run(`
    BTN.A = 1; input.held = [BTN.A, 0];
    const fireDelay = () => 10;
    for (let y = 0; y < MAP_H; y++) itemsLayer[y * MAP_W + 4] = 0;
    players = [{ id: 0, active: true, hp: 10, x: 20 << 8, y: 32 << 8,
      ch: { weapon: "sword", ult: "area" }, facing: 5, cd: 0, reloadT: 0, mana: 100 }];
    enemies = [{ x: 34 << 8, y: 42 << 8, box: {x:0,y:0,w:4,h:4}, hp: 10 }];
    updatePlayer(players[0]);
  `);
  assert.equal(run("players[0].slash"), 4);
  assert.equal(run("enemies[0].hp"), 10);
  assert.equal(run("itemHits.some(([x]) => x >= 40)"), false);
  run(`
    for (let y = 0; y < MAP_H; y++) itemsLayer[y * MAP_W + 4] = 8;
    players[0].cd = 0;
    updatePlayer(players[0]);
  `);
  assert.equal(run("enemies[0].hp"), 9);
  assert.equal(run("itemHits.some(([x]) => x >= 40)"), true);
});

test("la boca del arma no genera proyectiles al otro lado de un muro cercano", () => {
  const run = setup();
  run(`
    BTN.A = 1; input.held = [BTN.A, 0];
    CFG.bulletGroundOffset = 6; CFG.bulletLinger = 4;
    const fireDelay = () => 10, bulletRange = () => 88;
    for (let y = 0; y < MAP_H; y++) itemsLayer[y * MAP_W + 4] = 0;
    players = [{ id: 0, active: true, hp: 10, x: 20 << 8, y: 32 << 8,
      ch: { weapon: "gun", img: "kurtImage", ult: "area" }, facing: 5,
      cd: 0, reloadT: 0, mana: 100, ammo: 10 }];
    updatePlayer(players[0]);
  `);
  assert.equal(run("bullets.length"), 1);
  assert.equal(run("bullets[0].x >> 8"), 32);
  assert.equal(run("bullets[0].linger"), 5);
  assert.equal(run("itemHits.length"), 1);
  run(`
    for (let y = 0; y < MAP_H; y++) itemsLayer[y * MAP_W + 4] = 8;
    bullets = []; players[0].cd = 0; updatePlayer(players[0]);
  `);
  assert.equal(run("bullets[0].x >> 8"), 35);
  assert.equal(run("bullets[0].linger"), undefined);
});

test("el marcador diagonal del proyectil no se prolonga detras de un muro", () => {
  const run = setup();
  run(`
    MAP_W = 40; MAP_H = 40;
    fondoLayer = Array(MAP_W * MAP_H).fill(49);
    itemsLayer = Array(MAP_W * MAP_H).fill(-1);
    for (let y = 0; y < MAP_H; y++) itemsLayer[y * MAP_W + 20] = 0;
    const p = { id: 0, ch: { ult: "beam" }, x: 120 << 8, y: 120 << 8, facing: 6, mana: 100 };
    updateSpecial(p, BTN.SELECT);
  `);
  assert.equal(run("p.sp.cells.length > 0"), true);
  assert.equal(run("p.sp.cells.some(c => c.tx > 20)"), false);
});

test("el marcador diagonal del rayo pasa la colision media y se detiene ante la total", () => {
  const run = setup();
  run(`
    MAP_W = 40; MAP_H = 40;
    fondoLayer = Array(MAP_W * MAP_H).fill(49);
    itemsLayer = Array(MAP_W * MAP_H).fill(-1);
    for (let y = 0; y < MAP_H; y++) {
      itemsLayer[y * MAP_W + 20] = 8;
      itemsLayer[y * MAP_W + 24] = 0;
    }
    const p = { id: 0, ch: { ult: "beam" }, x: 120 << 8, y: 120 << 8, facing: 6, mana: 100 };
    updateSpecial(p, BTN.SELECT);
  `);
  assert.equal(run("p.sp.cells.some(c => c.tx > 20)"), true);
  assert.equal(run("p.sp.cells.some(c => c.tx >= 24)"), false);
});

test("el rayo respeta su alcance de 480 pixeles incluso en un mapa abierto", () => {
  const run = setup();
  run(`
    MAP_W = 100; MAP_H = 15;
    fondoLayer = Array(MAP_W * MAP_H).fill(49);
    itemsLayer = Array(MAP_W * MAP_H).fill(-1);
    const p = { id: 0, ch: { ult: "beam" }, x: 16 << 8, y: 32 << 8, facing: 5, mana: 100 };
    updateSpecial(p, BTN.SELECT);
  `);
  // El proyectil avanza 3 px y desaparece al agotar el alcance, antes de procesar el ultimo paso.
  assert.equal(run("p.sp.cells.at(-1).tx"), 62);
  assert.equal(run("p.sp.cells.some(c => c.tx >= 63)"), false);
});

test("no se inicia un especial sin carga y los proyectiles no crean explosiones", () => {
  const run = setup();
  run(`
    const p = { id: 0, ch: { ult: "beam" }, x: 16 << 8, y: 32 << 8, facing: 5, mana: 98 };
    updateSpecial(p, BTN.SELECT);
  `);
  assert.equal(run("p.sp"), undefined);
  assert.equal(run("p.mana"), 99);
  run(`
    const q = { id: 1, ch: { ult: "beam" }, x: 32 << 8, y: 48 << 8, facing: 3, mana: 100 };
    p.mana = 100;
    updateSpecial(p, BTN.SELECT); updateSpecial(q, BTN.SELECT);
    updateSpecial(p, 0); updateSpecialExplosions(); updateSpecial(q, 0);
  `);
  assert.equal(run("bullets.length"), 2);
  assert.equal(run("specialExplosions.length"), 0);
});

test("Kathy reproduce la explosion en bucle mientras el area esta activa y respeta mejoras de duracion", () => {
  const run = setup();
  run(`
    specialFrames = () => 270;
    players = [{ id: 0, ch: { ult: "area", img: "playerImage" }, x: 32 << 8, y: 32 << 8,
      facing: 5, row: 0, mana: 100, active: true, hp: 100, shield: 1 }];
    updateSpecial(players[0], BTN.SELECT);
    updateSpecial(players[0], 0);
    const cell = specialMarkerCells(players[0].sp)[0];
  `);
  for (let tick = 0; tick < 270; tick++) {
    run("draws.length = 0; render()");
    assert.equal(run("draws.filter(c => c.tx === cell.tx && c.ty === cell.ty).at(-1).id"),
      156 + Math.floor(tick / 12) % 4);
    run("updateSpecial(players[0], 0)");
  }
  assert.equal(run("players[0].sp"), null);
  run("draws.length = 0; render()");
  assert.equal(run("draws.filter(c => c.tx === cell.tx && c.ty === cell.ty).at(-1).id"), 49);
});

test("renderiza cada fotograma de explosion durante 12 ticks y lo elimina tras 48", () => {
  const run = setup();
  run("specialExplosions.push({cells:[{tx:2,ty:2}], age:0})");
  for (let tick = 0; tick < 48; tick++) {
    run("draws.length = 0; render()");
    assert.equal(run("draws.at(-1).id"), 156 + Math.floor(tick / 12));
    run("updateSpecialExplosions()");
  }
  assert.equal(run("specialExplosions.length"), 0);
});

test("la explosion no se dibuja si aparece colision media o total durante el efecto", () => {
  const run = setup();
  run(`
    specialExplosions.push({cells:[{tx:2,ty:2},{tx:3,ty:2},{tx:4,ty:2}], age:0});
    fondoLayer[2 * MAP_W + 2] = 8;
    itemsLayer[2 * MAP_W + 3] = 0;
    render();
  `);
  assert.equal(run("draws.filter(c => c.id === 156).map(c => c.tx).join(',')"), "4");
});

test("las cuatro partes de una lucky block herida usan el tileset aclarado y luego recuperan el original", () => {
  const run = setup();
  run(`
    const pixels = new Uint8ClampedArray(256 * 16 * 4);
    const offset = (y, x) => (y * 256 + x) * 4;
    pixels.set([75,110,26,255, 36,77,29,255, 9,39,15,255, 122,149,58,255, 9,39,15,0], offset(0, 216));
    pixels.set([200,0,0,255], offset(0, 0));
    assets.tilesetImage = { width: 256, height: 16, pixels };
    document.createElement = () => {
      const canvas = {};
      canvas.getContext = () => ({
        drawImage(image) { canvas.data = new Uint8ClampedArray(image.pixels); },
        getImageData() { return { data: canvas.data }; },
        putImageData(image) { canvas.pixels = image.data; }
      });
      return canvas;
    };
    hitImages.luckyTileset = makeLuckyHitImage(assets.tilesetImage);
    hitImages.tileset = { name: "normal-hit" };
    luckyBoxes = [{ tx: 2, ty: 2, alive: true, hit: 6 }];
    itemsLayer[2 * MAP_W + 2] = 27; itemsLayer[2 * MAP_W + 3] = 28;
    itemsLayer[3 * MAP_W + 2] = 59; itemsLayer[3 * MAP_W + 3] = 60;
    itemsLayer[2 * MAP_W + 6] = 19; barrierHit.set(2 * MAP_W + 6, 6);
    compSlot.set(2 * MAP_W + 2, 0); compCv = { name: "composite" };
    const images = [];
    ctx.drawImage = (image) => images.push(image);
    drawMapTile = actualDrawMapTile;
    render();
  `);
  assert.deepEqual(Array.from(run("hitImages.luckyTileset.pixels.slice(offset(0, 216), offset(0, 216) + 20)")),
    [122, 149, 58, 255, 75, 110, 26, 255, 36, 77, 29, 255, 122, 149, 58, 255, 9, 39, 15, 0]);
  assert.deepEqual(Array.from(run("hitImages.luckyTileset.pixels.slice(0, 4)")), [200, 0, 0, 255]);
  assert.equal(run("images.filter(image => image === hitImages.luckyTileset).length"), 4);
  assert.equal(run("images.filter(image => image === hitImages.tileset).length"), 1);
  assert.equal(run("images.includes(compCv)"), false);
  run("images.length = 0; luckyBoxes[0].hit = 0; render()");
  assert.equal(run("images.includes(hitImages.luckyTileset)"), false);
  assert.equal(run("images.includes(compCv)"), true);
});

test("recorta la mitad bloqueada y recompone el diamante y la moneda sobre el especial", () => {
  const run = setup();
  run(`
    const calls = [], clips = [];
    compCtx = {};
    specialCompCv = {};
    specialCompCtx = { clearRect() {}, save() {}, restore() {}, beginPath() {}, rect() {}, clip() {} };
    ctx.drawImage = () => calls.push("composite");
    ctx.rect = (...args) => clips.push(args);
    drawTileInto = (c, id, attr, x, y) => calls.push([id, attr, y].join(":"));
    transparentTiles.add(30);
    itemsLayer[2 * MAP_W + 2] = 30;
    itemsAttrs[2 * MAP_W + 2] = 32;
    drawSpecialTile(ctx, {tx:2,ty:2}, 88, 64);
  `);
  assert.equal(run("JSON.stringify(specialFreeParts(2,2))"), '[{"x":0,"y":0},{"x":4,"y":0}]');
  assert.equal(run("JSON.stringify(clips)"), "[[16,16,4,4],[20,16,4,4]]");
  assert.equal(run("calls.join(',')"), "88:64:0,30:32:0,composite");
  run(`
    calls.length = 0; clips.length = 0;
    itemsLayer[2 * MAP_W + 2] = PICKUP.coin;
    coinAnim.set(2 * MAP_W + 2, {fall:true,t:1});
    drawSpecialTile(ctx, {tx:2,ty:2}, 156, 0);
  `);
  assert.equal(run("calls.join(',')"), "156:0:0,153:32:-1,composite");
  run("calls.length = 0; coinAnim.get(2 * MAP_W + 2).fall = false; drawSpecialTile(ctx, {tx:2,ty:2}, 157, 0)");
  assert.equal(run("calls.join(',')"), "157:0:0,composite");
});

test("compone los tiles solicitados sobre el suelo 49 y sobre los especiales", () => {
  const run = setup();
  run(`
    const calls = [];
    compCtx = { clearRect() {}, save() {}, restore() {}, beginPath() {}, rect() {}, clip() {} };
    specialCompCv = {};
    specialCompCtx = compCtx;
    ctx.drawImage = () => {};
    drawTileInto = (c, id, attr) => calls.push([id, attr].join(":"));
    compFree.push(0);
    for (const id of FLOOR_COMPOSITE_TILES) transparentTiles.add(id);
    fondoLayer[42] = 8; itemsLayer[42] = 64; itemsAttrs[42] = 32;
    setComposite(42, 0);
  `);
  assert.equal(run("calls.join(',')"), "49:0,64:32");
  run("calls.length = 0; drawSpecialComposite(ctx, 42, 156, 64, 0, 0)");
  assert.equal(run("calls.join(',')"), "156:64,64:32");
  run("calls.length = 0; fondoLayer[42] = 69; drawSpecialComposite(ctx, 42, 156, 0, 0, 0)");
  assert.equal(run("calls.join(',')"), "156:0,64:32");
  run("calls.length = 0; fondoLayer[42] = 69; fondoAttrs[42] = 64; itemsLayer[42] = -1; setComposite(42, 0)");
  assert.equal(run("calls.join(',')"), "49:0,69:64");
  run("calls.length = 0; drawSpecialComposite(ctx, 42, 90, 32, 0, 0)");
  assert.equal(run("calls.join(',')"), "90:32,69:64");
  assert.equal(run("[64,65,66,67,69,70,71,72].every(id => needsComposite(id))"), true);
});

test("elimina solo el color de suelo de los tiles indicados al analizar el tileset", () => {
  const run = setup();
  run(`
    const pixels = new Uint8ClampedArray(256 * 64 * 4);
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = 75; pixels[i + 1] = 110; pixels[i + 2] = 26; pixels[i + 3] = 255;
    }
    const pixelAt = (id, x = 0, y = 0) => (((id >> 5) * 8 + y) * 256 + (id % 32) * 8 + x) * 4;
    pixels[pixelAt(64, 1)] = 9;
    let written;
    document.createElement = () => ({
      getContext: () => ({ drawImage() {}, getImageData: () => ({ data: pixels }),
        putImageData: (data) => { written = data.data; } })
    });
    assets.tilesetImage = { width: 256, height: 64 };
    scanTilesetTransparency();
  `);
  assert.equal(run("[64,65,66,67,69,70,71,72].every(id => written[pixelAt(id) + 3] === 0 && transparentTiles.has(id))"), true);
  assert.equal(run("written[pixelAt(64, 1) + 3]"), 255);
  assert.equal(run("written[pixelAt(49) + 3]"), 255);
  assert.equal(run("written[pixelAt(68) + 3]"), 255);
});

test("las alertas componen cofre o cristal y el 93 volteado sobre el fondo", () => {
  const run = setup();
  run(`
    const calls = [];
    compCtx = { clearRect() {}, save() {}, restore() {}, beginPath() {}, rect() {}, clip() {} };
    specialCompCv = {};
    specialCompCtx = compCtx;
    ctx.drawImage = () => {};
    drawTileInto = (c, id, attr) => calls.push([id, attr].join(":"));
    compFree.push(0);
    itemsLayer[42] = 93; itemsAttrs[42] = 32;
    setComposite(42, 0);
  `);
  assert.equal(run("calls.join(',')"), "49:0,29:32,93:32");
  run("calls.length = 0; itemsAttrs[42] = 0; setComposite(42, 0)");
  assert.equal(run("calls.join(',')"), "49:0,29:0,93:0");
  run("calls.length = 0; itemsLayer[42] = 126; itemsAttrs[42] = 64; setComposite(42, 0)");
  assert.equal(run("calls.join(',')"), "49:0,30:64,93:32");
  run("calls.length = 0; itemsLayer[42] = 127; itemsAttrs[42] = 0; drawSpecialComposite(ctx, 42, 157, 0, 0, 0)");
  assert.equal(run("calls.join(',')"), "157:0,31:0,93:0");
});

test("dibuja el marcador sobre items sin modificar las capas y lo sustituye por la explosion", () => {
  const run = setup();
  run(`
    itemsLayer[2 * MAP_W + 2] = PICKUP.coin;
    players = [{ active: true, hp: 10, x: 0, y: 0, ch: { img: "playerImage" },
      facing: 0, row: 0, sp: { state: "aim", tx: 2, ty: 2, w: 1, h: 1 } }];
    render();
  `);
  assert.equal(run("draws.filter(c => c.tx === 2 && c.ty === 2).map(c => c.id).join(',')"), "49,153,90,153");
  run("draws.length = 0; specialExplosions.push({cells:specialMarkerCells(players[0].sp),age:0}); players[0].sp.state = 'active'; players[0].sp.instant = true; render()");
  assert.equal(run("draws.filter(c => c.tx === 2 && c.ty === 2).map(c => c.id).join(',')"), "49,153,156,153");
  assert.equal(run("itemsLayer[2 * MAP_W + 2]"), 153);
});
