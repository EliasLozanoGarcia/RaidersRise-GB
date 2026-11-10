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
    assets = { tilesetImage: {}, playerImage: {} };
    drawHud = () => {};
    const draws = [];
    drawMapTile = (ctx, tx, ty, id, attr) => draws.push({ tx, ty, id, attr });
  `, context);
  return (code) => vm.runInContext(code, context);
}

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
  assert.equal(run("specialMarkerCells(players[0].sp).every(c => draws.some(d => d.tx === c.tx && d.ty === c.ty && d.id === 153))"), true);
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

test("el marcador del proyectil omite colision media pero continua hasta el muro", () => {
  const run = setup();
  run(`
    const p = { id: 0, ch: { ult: "beam" }, x: 16 << 8, y: 32 << 8, facing: 5, mana: 100 };
    itemsLayer[5 * MAP_W + 5] = 8;
    fondoLayer[5 * MAP_W + 7] = 8;
    itemsLayer[5 * MAP_W + 10] = 0;
    updateSpecial(p, BTN.SELECT);
  `);
  assert.equal(run("p.sp.cells.some(c => c.tx === 5 || c.tx === 7)"), false);
  assert.equal(run("p.sp.cells.some(c => c.tx === 9)"), true);
  assert.equal(run("p.sp.cells.some(c => c.tx >= 10)"), false);
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
      153 + Math.floor(tick / 12) % 4);
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
    assert.equal(run("draws.at(-1).id"), 153 + Math.floor(tick / 12));
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
  assert.equal(run("draws.filter(c => c.id === 153).map(c => c.tx).join(',')"), "4");
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
    itemsLayer[2 * MAP_W + 2] = 147;
    coinAnim.set(2 * MAP_W + 2, {fall:true,t:1});
    drawSpecialTile(ctx, {tx:2,ty:2}, 153, 0);
  `);
  assert.equal(run("calls.join(',')"), "153:0:0,147:32:-1,composite");
  run("calls.length = 0; coinAnim.get(2 * MAP_W + 2).fall = false; drawSpecialTile(ctx, {tx:2,ty:2}, 154, 0)");
  assert.equal(run("calls.join(',')"), "154:0:0,composite");
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
  run("calls.length = 0; drawSpecialComposite(ctx, 42, 153, 64, 0, 0)");
  assert.equal(run("calls.join(',')"), "153:64,64:32");
  run("calls.length = 0; fondoLayer[42] = 69; drawSpecialComposite(ctx, 42, 153, 0, 0, 0)");
  assert.equal(run("calls.join(',')"), "153:0,64:32");
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
  run("calls.length = 0; itemsLayer[42] = 127; itemsAttrs[42] = 0; drawSpecialComposite(ctx, 42, 154, 0, 0, 0)");
  assert.equal(run("calls.join(',')"), "154:0,31:0,93:0");
});

test("dibuja el marcador sobre items sin modificar las capas y lo sustituye por la explosion", () => {
  const run = setup();
  run(`
    itemsLayer[2 * MAP_W + 2] = 147;
    players = [{ active: true, hp: 10, x: 0, y: 0, ch: { img: "playerImage" },
      facing: 0, row: 0, sp: { state: "aim", tx: 2, ty: 2, w: 1, h: 1 } }];
    render();
  `);
  assert.equal(run("draws.filter(c => c.tx === 2 && c.ty === 2).map(c => c.id).join(',')"), "49,147,90,147");
  run("draws.length = 0; specialExplosions.push({cells:specialMarkerCells(players[0].sp),age:0}); players[0].sp.state = 'active'; players[0].sp.instant = true; render()");
  assert.equal(run("draws.filter(c => c.tx === 2 && c.ty === 2).map(c => c.id).join(',')"), "49,147,153,147");
  assert.equal(run("itemsLayer[2 * MAP_W + 2]"), 147);
});
