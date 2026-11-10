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
    let level = 1;
    let stats = { kills: 0 }, gameOver = false, goSel = 0;
    let enemies = [], players = [], bullets = [], specialExplosions = [], spawnPoints = [], wave = 0;
    function sfx() {}
  `, context);
  for (const file of ["utils.js", "progression.js", "tiles.js", "physics.js", "interactives.js", "levels.js", "entities.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", file), "utf8"), context);
  }
  vm.runInContext(`
    MAP_W = 20; MAP_H = 20;
    layouts = [1,2,3,4,5,6,7];
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

test("los limites de bioma, oleadas, agresividad y cristal siguen las tablas", () => {
  const run = setup();
  for (const [level, biome, waves, aggression, crystal] of [
    [1,0,1,256,false], [2,0,1,256,false], [3,0,2,320,true],
    [5,0,2,320,false], [6,0,3,384,true], [8,0,3,384,false],
    [9,0,4,512,true], [10,0,4,512,false], [11,1,4,512,false],
    [12,1,5,512,true], [15,1,6,512,true], [20,1,7,512,false],
    [21,2,8,512,true], [30,2,11,512,true], [31,0,11,512,false]
  ]) {
    assert.equal(run(`biomeIndex(${level})`), biome);
    assert.equal(run(`wavesPerPoint(${level})`), waves);
    assert.equal(run(`aggressionMultiplier(${level})`), aggression);
    assert.equal(run(`isCrystalLevel(${level})`), crystal);
  }
  run("CFG.chaseRange = 10");
  for (const [level, pixels] of [[1,80], [3,100], [6,120], [9,160]]) {
    assert.equal(run(`level = ${level}; chaseRangePixels()`), pixels);
  }
});

test("elige mapas aptos y no cuenta cofres solapados dos veces", () => {
  const run = setup();
  run(`
    function layout(chestColumns, crystal) {
      const w = 12, h = 5, items = Array(w * h).fill(-1);
      for (let x = 0; x < chestColumns; x++) { items[x] = 29; items[w + x] = 61; }
      if (crystal) { items[3*w] = 30; items[3*w+1] = 31; items[4*w] = 62; items[4*w+1] = 63; }
      return { w, h, items, itemsAttrs: Array(w*h).fill(0), fondo: Array(w*h).fill(49), fondoAttrs: Array(w*h).fill(0) };
    }
    const overlap = layout(3, false);
    const ordinary = layout(6, false);
    const crystalMap = layout(6, false);
    crystalMap.h = 6;
    crystalMap.items.push(...Array(12).fill(-1));
    crystalMap.fondo.push(...Array(12).fill(49));
    crystalMap.fondoAttrs.push(...Array(12).fill(0));
    crystalMap.itemsAttrs.push(...Array(12).fill(0));
    [crystalMap.items[36], crystalMap.items[37], crystalMap.items[48], crystalMap.items[49], crystalMap.items[60], crystalMap.items[61]] = [30,31,62,63,94,95];
    layouts = [overlap, ordinary, crystalMap];
  `);
  assert.equal(run("findMapRewards(overlap.items, overlap.w, overlap.h).chest.length"), 1);
  assert.equal(run("level = 1; pickLevel(); initialItemsLayer[2]"), 29);
  assert.equal(run("level = 3; pickLevel(); initialItemsLayer[60]"), 94);
  run("layouts = [layout(2, false)]; level = 1");
  assert.equal(run("pickLevel(); initialItemsLayer[0]"), 29);
  run("layouts = [ordinary]; level = 3");
  assert.throws(() => run("pickLevel()"), /No hay mapas compatibles/);
});

test("desbloquea trampas por nivel y elimina los dos lados de cada mecanismo", () => {
  const run = setup();
  run(`
    function hazardMap() {
      itemsLayer = Array(400).fill(-1); itemsAttrs = Array(400).fill(0);
      fondoLayer = Array(400).fill(49); fondoAttrs = Array(400).fill(0);
      itemsLayer[21] = 14; fondoLayer[23] = 16;
      itemsLayer[41] = 82; itemsLayer[42] = 82; itemsAttrs[42] = 32;
      itemsLayer[61] = 114; itemsLayer[62] = 114;
      itemsLayer[45] = 74; itemsLayer[46] = 74; itemsAttrs[46] = 32;
      itemsLayer[65] = 106; itemsLayer[66] = 106;
      itemsLayer[50] = 19;
      syncMapCell = () => {};
      initInteractives();
    }
  `);
  for (const [level, spikes, walls] of [[1,0,0],[3,0,0],[4,2,0],[6,2,0],[7,2,1],[9,2,1]]) {
    run(`level = ${level}; hazardMap()`);
    assert.equal(run("spikes.length"), spikes);
    assert.equal(run("lowerWalls.length"), walls);
    assert.equal(run("buttons.length"), walls);
    assert.equal(run("itemsLayer[50]"), 19);
    if (!spikes) {
      assert.equal(run("itemsLayer[21]"), -1);
      assert.equal(run("fondoLayer[23]"), 49);
    }
    if (!walls) assert.equal(run("[41,42,61,62,45,46,65,66].every(i => itemsLayer[i] === -1)"), true);
  }
  const combinations = new Set();
  for (let seed = 1; seed <= 100; seed++) {
    run(`rngState = ${seed}; level = 10; hazardMap()`);
    combinations.add(run("`${spikes.length},${lowerWalls.length}`"));
    assert.equal(run("lowerWalls.length === buttons.length"), true);
  }
  assert.deepEqual(combinations, new Set(["0,0", "0,1", "2,0", "2,1"]));
});

test("los pinchos del fondo no borran ni ocultan los objetos de la capa superior", () => {
  const run = setup();
  run(`
    syncMapCell = () => {};
    itemsLayer[21] = 27; itemsLayer[22] = 28;
    itemsLayer[41] = 59; itemsLayer[42] = 60;
    fondoLayer[21] = 14; level = 4;
    initInteractives();
  `);
  assert.equal(run("luckyBoxes.length"), 1);
  run("updateSpikeTile(spikes[0], 21, 16)");
  assert.equal(run("itemsLayer[21]"), 27);
  assert.equal(run("fondoLayer[21]"), 16);
  run("level = 1; initInteractives()");
  assert.equal(run("luckyBoxes.length"), 1);
  assert.equal(run("itemsLayer[21]"), 27);
  assert.equal(run("fondoLayer[21]"), 49);
});

test("cada punto recibe el numero de oleadas indicado por el nivel", () => {
  const run = setup();
  for (let level = 1; level <= 18; level++) {
    run(`level = ${level}; initSpawnPoints()`);
    assert.equal(run("spawnPoints.every(p => p.limit === wavesPerPoint(level))"), true);
    assert.equal(run("spawnPoints[0].limit"), 1 + Math.floor(level / 3));
  }
  run("levelLogic.spawners = [[0,0,8,8]]; level = 6; initSpawnPoints()");
  assert.equal(run("spawnPoints[0].limit"), 3);
  run("levelLogic.spawners = []; initSpawnPoints()");
  assert.equal(run("spawnPoints.length"), 0);
});

test("cada punto avanza independientemente y deja de generar tras su ultima oleada", () => {
  const run = setup();
  run("level = 3; initSpawnPoints(); for(let i=0;i<60;i++) updateSpawnPoints()");
  assert.equal(run("enemies.length"), 30);
  assert.equal(run("spawnPoints.filter(p => p.wave === 1).length"), 4);
  run(`
    const selected = spawnPoints[0];
    enemies.forEach(e => { if (e.spawnPoint === selected) e.hp = 0; });
    updateSpawnPoints(); updateSpawnPoints();
  `);
  assert.equal(run("selected.wave"), 2);
  assert.equal(run("enemies.filter(e => e.hp > 0 && e.spawnPoint !== selected).length"), 22);
  assert.equal(run("enemies.filter(e => e.hp > 0 && e.spawnPoint === selected).length"), 10);
  run("enemies.forEach(e => e.hp = 0); for(let i=0;i<2;i++) updateSpawnPoints()");
  assert.equal(run("spawnPoints.every(p => p.wave === 2)"), true);
  run("enemies.forEach(e => e.hp = 0); for(let i=0;i<100;i++) updateSpawnPoints()");
  assert.equal(run("enemies.filter(e => e.hp > 0).length"), 0);
  assert.equal(run("spawnPoints.reduce((n,p) => n+p.wave,0)"), 8);
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

test("los spawns personalizados pueden aumentar su cantidad en cada oleada", () => {
  const run = setup();
  run(`
    levelLogic = { customSpawners: [
      {x:0,y:0,w:8,h:8,type:"bee",waveBaseCount:5,waveIncrement:1},
      {x:64,y:64,w:8,h:8,type:"slime",count:3},
      {x:128,y:128,w:8,h:8,type:"bigSlime"}
    ] };
    initSpawnPoints();
  `);
  run("spawnPoints[0].wave = 1; spawnPoints[1].wave = 1");
  assert.equal(run("spawnPointCount(spawnPoints[0])"), 5);
  assert.equal(run("spawnPointCount(spawnPoints[1])"), 3);
  assert.equal(run("spawnPointCount(spawnPoints[2])"), 1);
  run("spawnPoints[0].wave = 2");
  assert.equal(run("spawnPointCount(spawnPoints[0])"), 6);
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

test("elige uno o dos cofres, con uno extra en niveles de cristal y sin reducir las cajas", () => {
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
    assert.equal(run("itemsLayer.filter(i => i === 27).length"), 5);
    assert.equal(run("[2,4].includes(itemsLayer.filter(i => i === 29).length)"), true);
    assert.equal(run("itemsLayer.filter(i => i === PICKUP.coin).length"), count);
  }
  run("level = 3; buildItems(); cullItems()");
  assert.equal(run("[4,6].includes(itemsLayer.filter(i => i === 29).length)"), true);
  run("itemsLayer.fill(-1); cullItems()");
  assert.equal(run("itemsLayer.filter(i => i >= 0).length"), 0);
});

test("conserva todos los cofres del mapa si hay dos o menos", () => {
  const run = setup();
  run(`
    function buildChestCount(count) {
      itemsLayer.fill(-1);
      for (let n=0; n<count; n++) {
        const x=n*3;
        itemsLayer[x]=29; itemsLayer[x+1]=29;
        itemsLayer[MAP_W+x]=61; itemsLayer[MAP_W+x+1]=61;
      }
    }
  `);
  for (const count of [0,1,2]) {
    run(`level = 1; buildChestCount(${count}); cullItems()`);
    assert.equal(run("findMapRewards(itemsLayer, MAP_W, MAP_H).chest.length"), count);
  }
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

test("extraer un cristal requiere 270 ticks y no entrega monedas", () => {
  const run = setup();
  run(`
    players = [{ active: true, hp: 3, crystals: 0, coins: 7 }];
    playerPushing = p => p.active;
    crystals = [{ tx: 4, ty: 4, pushTime: 0, mined: false }];
    for (let i = 0; i < 269; i++) updateInteractives();
  `);
  assert.equal(run("crystals[0].mined"), false);
  assert.equal(run("players[0].crystals"), 0);
  run("updateInteractives()");
  assert.equal(run("crystals[0].mined"), true);
  assert.equal(run("players[0].crystals"), 1);
  assert.equal(run("players[0].coins"), 7);
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
  assert.equal(run("level = 10; breakBox([20000])"), 148);
  for (const value of [0, 14000, 27000, 40000, 53000, 65535]) {
    assert.notEqual(run(`level = 10; breakBox([10000, 65535, ${value}])`), 148);
  }
});
