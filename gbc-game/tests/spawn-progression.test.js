"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function setup() {
  const context = vm.createContext({ window: {}, console: { warn() {}, log() {} } });
  vm.runInContext(`
    const CFG = { waveBase: 30, wavePerWave: 10, waveMax: 120, wavePause: 2,
      crystalCount: 1, hurtFlash: 6, enemyTypes: {
        slime: { weight: 1, hp: 2, size: 8, speed: 256 }
      }, speedJitter: 0 };
    let level = 1, layouts = [1,2,3,4,5,6,7], levelLogic = null;
    let stats = { kills: 0 }, gameOver = false, goSel = 0;
    let enemies = [], players = [], bullets = [], specialExplosions = [], spawnPoints = [], wave = 0;
    function sfx() {}
  `, context);
  for (const file of ["utils.js", "tiles.js", "physics.js", "interactives.js", "entities.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", file), "utf8"), context);
  }
  vm.runInContext(`
    MAP_W = 20; MAP_H = 20;
    itemsLayer = Array(400).fill(-1); itemsAttrs = Array(400).fill(0);
    fondoLayer = Array(400).fill(49); fondoAttrs = Array(400).fill(0);
    setItemTile = (idx, id, attr = 0) => { itemsLayer[idx] = id; itemsAttrs[idx] = attr; };
    levelLogic = { spawners: [[0,0,8,8],[64,0,8,8],[128,0,8,8],[0,64,8,8]] };
    let blocked = false;
    spawnEnemyAt = (x, y, type, point) => {
      if (blocked) return false;
      enemies.push({ hp: 1, spawnPoint: point, type });
      return true;
    };
  `, context);
  return (code) => vm.runInContext(code, context);
}

test("reparte oleadas seleccionadas por nivel sin asignarlas a todos a la vez", () => {
  const run = setup();
  for (let level = 1; level <= 12; level++) {
    run(`level = ${level}; initSpawnPoints()`);
    const selected = (level - 1) % 4;
    assert.equal(run("spawnPoints.filter(p => p.limit > 1).length"), selected);
    assert.equal(run("spawnPoints.every(p => p.limit === 1 || p.limit === level)"), true);
  }
  run("levelLogic.spawners = [[0,0,8,8]]; level = 6; initSpawnPoints()");
  assert.equal(run("spawnPoints[0].limit"), 6);
  run("levelLogic.spawners = []; initSpawnPoints()");
  assert.equal(run("spawnPoints.length"), 0);
});

test("cada punto avanza independientemente y deja de generar tras su ultima oleada", () => {
  const run = setup();
  run("level = 2; initSpawnPoints(); for(let i=0;i<60;i++) updateSpawnPoints()");
  assert.equal(run("enemies.length"), 30);
  assert.equal(run("spawnPoints.filter(p => p.wave === 1).length"), 4);
  run(`
    const selected = spawnPoints.find(p => p.limit === 2);
    enemies.forEach(e => { if (e.spawnPoint === selected) e.hp = 0; });
    updateSpawnPoints(); updateSpawnPoints();
  `);
  assert.equal(run("selected.wave"), 2);
  assert.equal(run("enemies.filter(e => e.hp > 0 && e.spawnPoint !== selected).length"), 22);
  assert.equal(run("enemies.filter(e => e.hp > 0 && e.spawnPoint === selected).length"), 10);
  run("enemies.forEach(e => e.hp = 0); for(let i=0;i<100;i++) updateSpawnPoints()");
  assert.equal(run("enemies.filter(e => e.hp > 0).length"), 0);
  assert.equal(run("spawnPoints.reduce((n,p) => n+p.wave,0)"), 5);
});

test("los spawns personalizados respetan su tipo y cantidad de forma independiente", () => {
  const run = setup();
  run(`
    levelLogic = { spawners: [[0,0,8,8]], customSpawners: [{x:64,y:64,w:8,h:8,type:"slime",count:3}] };
    initSpawnPoints(); for(let i=0;i<60;i++) updateSpawnPoints();
  `);
  assert.equal(run("enemies.length"), 33);
  assert.equal(run("enemies.filter(e => e.spawnPoint === spawnPoints[1] && e.type === 'slime').length"), 3);
});

test("si no puede generar una oleada la reintenta sin descontarla ni depender de otros puntos", () => {
  const run = setup();
  run("level = 2; initSpawnPoints(); blocked = true; for(let i=0;i<60;i++) updateSpawnPoints()");
  assert.equal(run("enemies.length"), 0);
  assert.equal(run("spawnPoints.every(p => p.wave === 1 && p.pending > 0)"), true);
  run("blocked = false; for(let i=0;i<30;i++) updateSpawnPoints()");
  assert.equal(run("enemies.length"), 30);
  assert.equal(run("spawnPoints.every(p => p.wave === 1 && p.pending === 0)"), true);
});

test("una oleada parcialmente generada no se repite ni avanza hasta generar y eliminar todos sus enemigos", () => {
  const run = setup();
  run(`
    levelLogic.spawners = [[0,0,8,8]];
    CFG.waveBase = 3; initSpawnPoints();
    let quota = 1;
    spawnEnemyAt = (x, y, type, point) => {
      if (quota-- <= 0) return false;
      enemies.push({ hp: 1, spawnPoint: point }); return true;
    };
    for (let i=0;i<60;i++) updateSpawnPoints();
  `);
  assert.equal(run("enemies.length"), 1);
  assert.equal(run("spawnPoints[0].pending"), 2);
  run("quota = 2; for (let i=0;i<30;i++) updateSpawnPoints()");
  assert.equal(run("enemies.length"), 3);
  assert.equal(run("spawnPoints[0].pending"), 0);
  run("enemies.forEach(e => e.hp = 0); for(let i=0;i<100;i++) updateSpawnPoints()");
  assert.equal(run("enemies.length"), 3);
});

test("al continuar se reinician solamente las oleadas que estaban en curso", () => {
  const run = setup();
  run(`
    level = 1; initSpawnPoints(); for(let i=0;i<60;i++) updateSpawnPoints();
    enemies.forEach(e => { if (e.spawnPoint === spawnPoints[0]) e.hp = 0; });
    continueGame();
  `);
  assert.equal(run("spawnPoints[0].pending"), 0);
  assert.equal(run("spawnPoints.slice(1).every(p => p.pending > 0 && p.timer === 60)"), true);
  run("for(let i=0;i<60;i++) updateSpawnPoints()");
  assert.equal(run("enemies.some(e => e.spawnPoint === spawnPoints[0])"), false);
  assert.equal(run("enemies.length"), 22);
});

test("conserva todos los recursos en nivel 1 y reduce hasta un minimo de uno", () => {
  const run = setup();
  run(`
    function put(x, y, ids) {
      for (let i=0; i<ids.length; i++) itemsLayer[(y + Math.floor(i/2))*MAP_W + x + i%2] = ids[i];
    }
    function buildItems() {
      itemsLayer.fill(-1);
      for (let n=0;n<5;n++) {
        put(n*3,0,[29,29,61,61]);
        put(n*3,4,[27,28,59,60]);
        itemsLayer[8*MAP_W+n] = PICKUP.coin;
      }
    }
  `);
  for (const [level, count] of [[1,5],[2,4],[4,2],[5,1],[50,1]]) {
    run(`level = ${level}; buildItems(); cullItems()`);
    assert.equal(run("itemsLayer.filter(i => i === 27).length"), count);
    assert.equal(run("itemsLayer.filter(i => i === 29).length"), count * 2);
    assert.equal(run("itemsLayer.filter(i => i === PICKUP.coin).length"), count);
  }
  run("itemsLayer.fill(-1); cullItems()");
  assert.equal(run("itemsLayer.filter(i => i >= 0).length"), 0);
});

test("los cristales grandes aparecen solo cada tres niveles y respetan el limite configurado", () => {
  const run = setup();
  run(`
    function buildCrystals() {
      itemsLayer.fill(-1);
      for (const x of [2, 6, 10]) {
        for (const [dy, ids] of [[0,[30,31]],[1,[62,63]],[2,[94,95]]]) {
          for (let dx = 0; dx < 2; dx++) itemsLayer[(2 + dy) * MAP_W + x + dx] = ids[dx];
        }
      }
    }
  `);
  for (let level = 1; level <= 9; level++) {
    run(`level = ${level}; buildCrystals(); cullItems()`);
    const expected = level % 3 === 0 ? 1 : 0;
    for (const id of [30, 31, 62, 63, 94, 95]) {
      assert.equal(run(`itemsLayer.filter(i => i === ${id}).length`), expected, `nivel ${level}, tile ${id}`);
    }
  }
  run("level = 12; CFG.crystalCount = 2; buildCrystals(); cullItems()");
  assert.equal(run("itemsLayer.filter(i => i === 30).length"), 2);
  run("level = 13; buildCrystals(); cullItems()");
  assert.equal(run("itemsLayer.filter(i => i === 30).length"), 0);
  run("level = 15; itemsLayer.fill(-1); cullItems()");
  assert.equal(run("itemsLayer.some(i => i >= 0)"), false);
});

test("los cofres reducen monedas directas y recogibles sin afectar al minimo", () => {
  const run = setup();
  run("let spawnedCoins = []; spawnCoins = cells => { spawnedCoins = cells; }; const p = {coins:0};");
  for (const [level, direct, ground] of [[1,5,12],[2,4,11],[5,1,8],[12,1,1],[40,1,1]]) {
    run(`level=${level}; itemsLayer.fill(-1); p.coins=0; openCoinChest({tx:4,ty:4},p)`);
    assert.equal(run("p.coins"), direct);
    assert.equal(run("spawnedCoins.length"), ground);
  }
});

test("la probabilidad de moneda enemiga baja 10 puntos por nivel hasta el 10 por ciento", () => {
  const run = setup();
  run("let drops = 0; dropCoin = () => drops++;");
  for (const [level, threshold] of [[1,10],[2,9],[9,2],[10,1],[100,1]]) {
    run(`level=${level}; drops=0; rand16 = () => Math.ceil(${threshold-1} * 65536 / 10); damageEnemy({hp:1,coin:true},1)`);
    assert.equal(run("drops"), 1);
    if (threshold < 10) {
      run(`rand16 = () => Math.ceil(${threshold} * 65536 / 10); damageEnemy({hp:1,coin:true},1)`);
      assert.equal(run("drops"), 1);
    }
  }
});

test("las cajas conservan premio y reducen la probabilidad de moneda", () => {
  const run = setup();
  run(`
    function breakBox(values) {
      let n = 0;
      rand16 = () => values[n++];
      itemsLayer.fill(-1);
      luckyBoxes = [{tx:4,ty:4,hp:1,alive:true}];
      checkBulletHitItems(32,32);
      return itemsLayer[4*MAP_W+4];
    }
  `);
  assert.equal(run("level = 1; breakBox([10000, 65535])"), 147);
  assert.equal(run("level = 10; breakBox([10000, 0])"), 147);
  assert.equal(run("level = 10; breakBox([10000, 65535, 0])"), 146);
});
