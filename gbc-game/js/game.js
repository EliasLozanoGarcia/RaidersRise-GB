/*
 * Prototipo: accion top-down con colisiones por tiles y graficos PNG a color original.
 */
(function () {
  "use strict";

  const canvas = document.getElementById("screen");
  const gbc = new GBC(canvas);
  const input = new Input();

  // ------------------------------------------------------------ Parametros de juego
  const CFG = {
    playerSpeed: 1.25,
    enemySpeed: 0.1,
    chaseRange: 5,
    blastRadius: 2,
    fuseRadius: 8,
    blastFrames: 10,
    wanderFactor: 0.5,
    speedJitter: 0.10,
    teleportDistance: 2,
    teleportCooldown: 40,
    teleportStepFrames: 4,
    teleportEffectFrames: 32,
    hurtFlash: 6,
    bulletSpeed: 3 * 256,
    bulletRange: 112,
    fireRate: 2,
    waveBase: 3,
    wavePerWave: 1,
    waveMax: 12,
    playerHp: 3,
    enemyHp: 2,
    invuln: 90,
    runAnimFrames: 6,
    pushAnimFrames: 8,
    enemyAnimFrames: 14,
    wavePause: 90,
  };
  const DIAG = 181; // 256 * 0.7071

  // Hitboxes
  const PBOX = { x: 4, y: 10, w: 8, h: 6 };
  const EBOX = { x: 1, y: 1, w: 6, h: 6 };
  const BBOX = { x: 2, y: 2, w: 4, h: 4 };

  const DIRS = [[-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1]];
  const DIR_INDEX = [];
  DIRS.forEach((d, i) => { DIR_INDEX[(d[1] + 1) * 3 + (d[0] + 1)] = i; });

  let MAP_W = 32, MAP_H = 32;
  const VIEW_H = 144;
  let assets;

  // ------------------------------------------------------------ Tablas de Colisiones
  const COL_TOTAL = new Set([
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37,
    38, 39, 40, 41, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 94, 95, 96,
    97, 98, 99, 100, 101
  ]);

  const COL_MEDIA = new Set([
    8, 9, 10, 11, 12, 13, 19, 20, 21, 22, 23, 42, 43, 44, 45, 46
  ]);

  let itemsLayer = [];
  let fondoLayer = [];
  let itemsAttrs = [];
  let fondoAttrs = [];
  let initialItemsLayer = [];
  let initialItemsAttrs = [];

  function syncMapCell(idx) {
    const itemTile = itemsLayer[idx];
    const hasItem = itemTile >= 0;
    const tileId = hasItem ? itemTile : fondoLayer[idx];
    gbc.mapTile[0][idx] = tileId >= 0 ? tileId : 0;
    gbc.mapAttr[0][idx] = hasItem ? itemsAttrs[idx] : fondoAttrs[idx];
  }

  function setItemTile(idx, gid, attr = 0) {
    itemsLayer[idx] = gid;
    itemsAttrs[idx] = attr;
    syncMapCell(idx);
  }

  function getTileCollision(tileId) {
    if (tileId < 0) return 0;
    if (COL_TOTAL.has(tileId)) return 2; // Total
    if (COL_MEDIA.has(tileId)) return 1; // Media (permite balas)
    return 0;
  }

  function getCellCollision(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return 2;
    const idx = ty * MAP_W + tx;

    const iCol = getTileCollision(itemsLayer[idx]);
    if (iCol !== 0) return iCol;

    return getTileCollision(fondoLayer[idx]);
  }

  function boxBlocked(x, y, b, isFlying = false, limitToCam = false) {
    const l = x + b.x, t = y + b.y, r = l + b.w - 1, bt = t + b.h - 1;
    if (limitToCam && (l < cam.x || r >= cam.x + 160 || t < cam.y || bt >= cam.y + VIEW_H)) return true;

    for (let ty = t >> 3; ty <= bt >> 3; ty++) {
      for (let tx = l >> 3; tx <= r >> 3; tx++) {
        const col = getCellCollision(tx, ty);
        if (col === 2) return true;
        if (col === 1 && !isFlying) return true;
      }
    }
    return false;
  }

  function tryMove(e, dx, dy, box, limitToCam, extra) {
    let moved = false;
    const nx = e.x + dx;
    if (dx && !boxBlocked(nx >> 8, e.y >> 8, box, false, limitToCam) && !(extra && extra(nx >> 8, e.y >> 8))) {
      e.x = nx;
      moved = true;
    }
    const ny = e.y + dy;
    if (dy && !boxBlocked(e.x >> 8, ny >> 8, box, false, limitToCam) && !(extra && extra(e.x >> 8, ny >> 8))) {
      e.y = ny;
      moved = true;
    }
    return moved;
  }

  function enemyBlocks(enemy, nx, ny) {
    const ox = enemy.x >> 8;
    const oy = enemy.y >> 8;
    return enemies.some((other) =>
      other !== enemy &&
      other.hp > 0 &&
      overlap(nx, ny, EBOX, other.x >> 8, other.y >> 8, EBOX) &&
      !overlap(ox, oy, EBOX, other.x >> 8, other.y >> 8, EBOX)
    );
  }

  function findFree(x, y, box, extra) {
    const isFree = (px, py) =>
      !boxBlocked(px, py, box) && !(extra && extra(px, py));
    if (isFree(x, y)) return [x, y];

    for (let radius = 4; radius <= 96; radius += 4) {
      for (let oy = -radius; oy <= radius; oy += 4) {
        for (let ox = -radius; ox <= radius; ox += 4) {
          if (Math.max(Math.abs(ox), Math.abs(oy)) !== radius) continue;
          if (isFree(x + ox, y + oy)) return [x + ox, y + oy];
        }
      }
    }
    return [x, y];
  }

  // ------------------------------------------------------------ Objetos Interactivos
  let spikes = [];
  let manaBoxes = [];
  let coinChests = [];
  let doors = [];

  function initInteractives() {
    spikes = [];
    manaBoxes = [];
    coinChests = [];
    doors = [];

    for (let ty = 0; ty < MAP_H; ty++) {
      for (let tx = 0; tx < MAP_W; tx++) {
        const idx = ty * MAP_W + tx;
        const t = itemsLayer[idx];

        // 14: Pincho
        if (t === 14) {
          spikes.push({ tx, ty, t: 0, state: 0 });
        }
        // 27: Esquina superior izquierda de caja de mana (27, 28, 59, 60)
        else if (t === 27 && tx + 1 < MAP_W && ty + 1 < MAP_H) {
          manaBoxes.push({ tx, ty, hp: 3, alive: true });
        }
        // Cofre de monedas: dos tiles superiores 29 y dos inferiores 61.
        else if (
          t === 29 && tx + 1 < MAP_W && ty + 1 < MAP_H &&
          itemsLayer[idx + 1] === 29 &&
          itemsLayer[idx + MAP_W] === 61 &&
          itemsLayer[idx + MAP_W + 1] === 61 &&
          (tx === 0 || itemsLayer[idx - 1] !== 29)
        ) {
          coinChests.push({ tx, ty, pushTime: 0, opened: false });
        }
        // Puerta vertical abierta: de arriba hacia abajo, 70, 69, 68.
        else if (
          t === 70 && ty + 2 < MAP_H &&
          itemsLayer[idx + MAP_W] === 69 &&
          itemsLayer[idx + MAP_W * 2] === 68
        ) {
          const openTiles = [idx, idx + MAP_W, idx + MAP_W * 2];
          doors.push({
            tx,
            ty,
            pushTime: 0,
            open: true,
            openTopY: ty,
            openTiles,
            openAttrs: openTiles.map((cell) => itemsAttrs[cell]),
          });
        }
        // Puerta horizontal de dos filas; admite un centro de longitud variable.
        else if (
          t === 64 && ty + 1 < MAP_H &&
          itemsLayer[idx + MAP_W] === 96 &&
          !(itemsAttrs[idx] & 0x20) &&
          !(itemsAttrs[idx + MAP_W] & 0x20)
        ) {
          let width = 1;
          while (tx + width < MAP_W) {
            const top = idx + width;
            const bottom = top + MAP_W;
            if (
              itemsLayer[top] === 64 &&
              itemsLayer[bottom] === 96 &&
              (itemsAttrs[top] & 0x20) &&
              (itemsAttrs[bottom] & 0x20)
            ) {
              if (width >= 2) {
                const cells = [];
                for (let row = 0; row < 2; row++) {
                  for (let col = 0; col <= width; col++) cells.push(idx + row * MAP_W + col);
                }
                doors.push({
                  tx,
                  ty,
                  width: width + 1,
                  pushTime: 0,
                  open: false,
                  tiles: cells.map((cell) => itemsLayer[cell]),
                  attrs: cells.map((cell) => itemsAttrs[cell]),
                  cells,
                  openTopY: ty - 1,
                  openTiles: [
                    (ty - 1) * MAP_W + tx,
                    ty * MAP_W + tx,
                    (ty + 1) * MAP_W + tx,
                  ],
                  openAttrs: [0, 0, 0],
                });
              }
              break;
            }
            if (itemsLayer[top] !== 65 || itemsLayer[bottom] !== 97) break;
            width++;
          }
        }
      }
    }
  }

  function playerPushing(p, box) {
    if (!p.active || p.hp <= 0 || p.tp) return false;
    const held = input.held[p.id];
    const dx = ((held & BTN.RIGHT) ? 1 : 0) - ((held & BTN.LEFT) ? 1 : 0);
    const dy = ((held & BTN.DOWN) ? 1 : 0) - ((held & BTN.UP) ? 1 : 0);
    if (!dx && !dy) return false;

    const interactionBox = { x: box.x - 6, y: box.y - 6, w: box.w + 12, h: box.h + 12 };
    if (!overlap(p.x >> 8, p.y >> 8, PBOX, interactionBox.x, interactionBox.y, interactionBox)) return false;

    const playerCenterX = (p.x >> 8) + 8;
    const playerCenterY = (p.y >> 8) + 13;
    const targetX = box.x + box.w / 2;
    const targetY = box.y + box.h / 2;
    if (dx * (targetX - playerCenterX) + dy * (targetY - playerCenterY) <= 0) return false;
    p.pushing = true;
    p.pushFacing = DIR_INDEX[(dy + 1) * 3 + (dx + 1)];
    return true;
  }

  function openCoinChest(chest, player) {
    chest.opened = true;
    player.coins += 5;

    const chestCells = [];
    for (let oy = 0; oy < 2; oy++) {
      for (let ox = 0; ox < 2; ox++) {
        const idx = (chest.ty + oy) * MAP_W + chest.tx + ox;
        chestCells.push(idx);
        setItemTile(idx, -1);
      }
    }

    for (const idx of chestCells) setItemTile(idx, 25);

    let extraCoins = 0;
    for (let radius = 1; radius <= 2 && extraCoins < 8; radius++) {
      for (let oy = -radius; oy <= 1 + radius && extraCoins < 8; oy++) {
        for (let ox = -radius; ox <= 1 + radius && extraCoins < 8; ox++) {
          if (Math.max(
            Math.abs(ox - 0.5),
            Math.abs(oy - 0.5)
          ) < radius) continue;

          const tx = chest.tx + ox;
          const ty = chest.ty + oy;
          if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) continue;
          const idx = ty * MAP_W + tx;
          if (itemsLayer[idx] !== -1 || getCellCollision(tx, ty) !== 0) continue;

          setItemTile(idx, 25);
          extraCoins++;
        }
      }
    }
  }

  function updateInteractives() {
    for (const p of players) p.pushing = false;

    // A) PINCHOS (14 -> 3s -> 16 activo con daño -> 1s -> 15 bajando -> 0.3s -> 14)
    for (const s of spikes) {
      s.t++;
      const idx = s.ty * MAP_W + s.tx;
      if (s.state === 0 && s.t >= 180) { // 3 segundos
        s.state = 1;
        s.t = 0;
        setItemTile(idx, 16);
        setItemTile(idx, 16);
      } else if (s.state === 1) {
        const sBox = { x: s.tx * 8, y: s.ty * 8, w: 8, h: 8 };
        for (const p of players) {
          if (p.active && p.hp > 0 && !p.tp && p.inv === 0 &&
              overlap(p.x >> 8, p.y >> 8, PBOX, sBox.x, sBox.y, sBox)) {
            p.hp--;
            p.inv = CFG.invuln;
            p.hit = CFG.hurtFlash;
          }
        }
        for (const e of enemies) {
          if (e.hp > 0 && overlap(e.x >> 8, e.y >> 8, EBOX, sBox.x, sBox.y, sBox)) {
            damageEnemy(e, 1);
          }
        }
        if (s.t >= 60) { // 1 segundo
          s.state = 2;
          s.t = 0;
          setItemTile(idx, 15);
          setItemTile(idx, 15);
        }
      } else if (s.state === 2 && s.t >= 18) { // 0.3 segundos
        s.state = 0;
        s.t = 0;
        setItemTile(idx, 14);
        setItemTile(idx, 14);
      }
    }

    // B) COFRE DE MONEDAS EMPUJABLE (29, 61)
    for (const c of coinChests) {
      if (c.opened) continue;
      const cBox = { x: c.tx * 8, y: c.ty * 8, w: 16, h: 16 };
      const pusher = players.find((p) => playerPushing(p, cBox));
      if (pusher) {
        c.pushTime++;
        if (c.pushTime >= 90) { // 1.5s empujando para abrir
          openCoinChest(c, pusher);
        }
      } else {
        c.pushTime = 0;
      }
    }

    // C) PUERTAS EMPUJABLES: al abrirse, la hoja gira y queda junto al marco.
    for (const d of doors) {
      if (d.open) {
        const verticalBox = { x: d.tx * 8, y: d.openTopY * 8, w: 8, h: 24 };
        const pushing = players.some((p) => playerPushing(p, verticalBox));
        const openDoorTiles = pushing ? [101, 100, 68] : [70, 69, 68];
        d.openTiles.forEach((cell, i) => setItemTile(cell, openDoorTiles[i], d.openAttrs[i]));
        continue;
      }
      const hBox = { x: d.tx * 8, y: d.ty * 8, w: d.width * 8, h: 16 };
      const pushingH = players.some((p) => playerPushing(p, hBox));
      if (pushingH) {
        d.pushTime++;
        for (let col = 1; col < d.width; col++) {
          const top = d.ty * MAP_W + d.tx + col;
          const bottom = top + MAP_W;
          const isRightEdge = col === d.width - 1;
          setItemTile(top, isRightEdge ? 67 : 66, isRightEdge ? 0 : d.attrs[col]);
          setItemTile(bottom, isRightEdge ? 99 : 98, isRightEdge ? 0 : d.attrs[d.width + col]);
        }

        if (d.pushTime >= 90) {
          d.open = true;
          d.cells.forEach((cell) => setItemTile(cell, -1));
          const openDoorTiles = [70, 69, 68];
          d.openTiles.forEach((cell, i) => setItemTile(cell, openDoorTiles[i], d.openAttrs[i]));
        }
      } else if (d.pushTime > 0) {
        d.pushTime = 0;
        d.cells.forEach((cell, i) => setItemTile(cell, d.tiles[i], d.attrs[i]));
      }
    }
  }

  function checkBulletHitItems(bx, by) {
    const tx = bx >> 3, ty = by >> 3;
    if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return false;
    const idx = ty * MAP_W + tx;
    const t = itemsLayer[idx];

    // Barreras destruibles (19 a 23) -> pasan a 24 sin colision
    if (t >= 19 && t <= 23) {
      setItemTile(idx, 24);
      return true;
    }

    // Caja de mana (27, 28, 59, 60)
    for (const b of manaBoxes) {
      if (!b.alive) continue;
      if (tx >= b.tx && tx <= b.tx + 1 && ty >= b.ty && ty <= b.ty + 1) {
        b.hp--;
        if (b.hp <= 0) {
          b.alive = false;
          for (let r = 0; r < 2; r++) {
            for (let c = 0; c < 2; c++) {
              const i = (b.ty + r) * MAP_W + (b.tx + c);
              setItemTile(i, -1);
            }
          }
          const dropIdx = b.ty * MAP_W + b.tx;
          setItemTile(dropIdx, 26);
        }
        return true;
      }
    }
    return false;
  }

  // ------------------------------------------------------------ Estado del Juego
  const cam = { x: 0, y: 0 };
  let frame = 0, wave = 0, waveTimer = 0, gameOver = false, paused = false;
  let players = [], enemies = [], bullets = [];
  let teleportEffects = [];
  const blasts = new Map();

  function overlap(ax, ay, a, bx, by, b) {
    return ax + a.x < bx + b.x + b.w && ax + a.x + a.w > bx + b.x &&
           ay + a.y < by + b.y + b.h && ay + a.y + a.h > by + b.y;
  }

  function newPlayer(i, x, y) {
    return { id: i, x: x << 8, y: y << 8, facing: 7, hp: CFG.playerHp, coins: 0, cd: 0,
             inv: 0, animT: 0, row: 0, active: i === 0, hit: 0, tpCooldown: 0,
             pushing: false, pushFacing: 7, pushAnimT: 0 };
  }

  function resetGame() {
    itemsLayer = initialItemsLayer.slice();
    itemsAttrs = initialItemsAttrs.slice();
    for (let i = 0; i < MAP_W * MAP_H; i++) syncMapCell(i);
    players = [newPlayer(0, 120, 160), newPlayer(1, 160, 160)];
    enemies = [];
    bullets = [];
    teleportEffects = [];
    blasts.clear();
    wave = 0;
    waveTimer = 60;
    gameOver = false;
    paused = false;
    cam.x = 48;
    cam.y = 80;
    initInteractives();
  }

  const SPAWNS = [[10, 10], [20, 10], [12, 25], [22, 26], [8, 18], [18, 18], [26, 10], [6, 26]];

  function spawnEnemyAt(tileX, tileY) {
    for (let radius = 0; radius < Math.max(MAP_W, MAP_H); radius++) {
      for (let oy = -radius; oy <= radius; oy++) {
        for (let ox = -radius; ox <= radius; ox++) {
          if (radius && Math.abs(ox) !== radius && Math.abs(oy) !== radius) continue;
          const x = (tileX + ox) * 8;
          const y = (tileY + oy) * 8;
          if (boxBlocked(x, y, EBOX) || enemies.some((e) => overlap(x, y, EBOX, e.x >> 8, e.y >> 8, EBOX))) continue;
          enemies.push({
            x: x << 8,
            y: y << 8,
            hp: CFG.enemyHp,
            animT: 0,
            moving: false,
            dir: 7,
            speedScale: 1 + (Math.random() * 2 - 1) * CFG.speedJitter,
            wanderDir: -1,
            wanderTimer: 0,
          });
          return true;
        }
      }
    }
    return false;
  }

  function spawnWave() {
    wave++;
    const count = Math.min(CFG.waveBase + (wave - 1) * CFG.wavePerWave, CFG.waveMax);
    let spawned = 0;
    for (let i = 0; i < SPAWNS.length * 4 && spawned < count; i++) {
      const [x, y] = SPAWNS[(i + wave - 1) % SPAWNS.length];
      const px = x * 8, py = y * 8;
      if (players.some((p) => p.active && p.hp > 0 && Math.abs((p.x >> 8) - px) < 48 && Math.abs((p.y >> 8) - py) < 48)) continue;
      if (spawnEnemyAt(x, y)) spawned++;
    }
    waveTimer = spawned ? CFG.wavePause : 30;
  }

  function dropCoin(enemy) {
    const originX = ((enemy.x >> 8) + 4) >> 3;
    const originY = ((enemy.y >> 8) + 4) >> 3;
    for (let radius = 0; radius <= 2; radius++) {
      for (let oy = -radius; oy <= radius; oy++) {
        for (let ox = -radius; ox <= radius; ox++) {
          if (Math.max(Math.abs(ox), Math.abs(oy)) !== radius) continue;
          const tx = originX + ox;
          const ty = originY + oy;
          if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) continue;
          const idx = ty * MAP_W + tx;
          if (itemsLayer[idx] !== -1 || getCellCollision(tx, ty) !== 0) continue;
          setItemTile(idx, 25);
          return;
        }
      }
    }
  }

  function damageEnemy(enemy, amount) {
    if (enemy.hp <= 0) return;
    enemy.hp = Math.max(0, enemy.hp - amount);
    enemy.hit = CFG.hurtFlash;
    if (enemy.hp === 0) dropCoin(enemy);
  }

  function explode(cx, cy) {
    const radius = CFG.blastRadius * 8;
    for (const enemy of enemies) {
      if (enemy.hp <= 0) continue;
      const dx = (enemy.x >> 8) + 4 - cx;
      const dy = (enemy.y >> 8) + 4 - cy;
      if (dx * dx + dy * dy <= radius * radius) damageEnemy(enemy, 1);
    }

    for (let ty = Math.floor((cy - radius) / 8); ty <= Math.floor((cy + radius) / 8); ty++) {
      for (let tx = Math.floor((cx - radius) / 8); tx <= Math.floor((cx + radius) / 8); tx++) {
        if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H || getCellCollision(tx, ty) !== 0) continue;
        const nearestX = Math.max(tx * 8, Math.min(cx, tx * 8 + 8));
        const nearestY = Math.max(ty * 8, Math.min(cy, ty * 8 + 8));
        if ((nearestX - cx) ** 2 + (nearestY - cy) ** 2 <= radius * radius) {
          blasts.set(ty * MAP_W + tx, CFG.blastFrames);
        }
      }
    }
  }

  function startTeleport(player, facing) {
    const direction = DIRS[facing];
    const length = Math.hypot(direction[0], direction[1]);
    const unitX = direction[0] / length;
    const unitY = direction[1] / length;
    const centerX = (player.x >> 8) + 8;
    const centerY = (player.y >> 8) + 9;
    const distance = CFG.teleportDistance * 8;
    const candidates = [];
    for (let radius = distance; radius <= distance + 24; radius += 2) candidates.push(radius);
    for (let radius = distance - 2; radius >= 4; radius -= 2) candidates.push(radius);

    let destination = null;
    for (const radius of candidates) {
      const x = Math.round(centerX + unitX * radius) - 8;
      const y = Math.round(centerY + unitY * radius) - 9;
      if (!boxBlocked(x, y, PBOX, false, true)) {
        destination = [x, y];
        break;
      }
    }
    if (!destination) return false;

    const entryX = Math.round(centerX + unitX * 8) - 8;
    const entryY = Math.round(centerY + unitY * 8) - 9;
    player.facing = facing;
    player.tp = {
      step: 0,
      timer: 0,
      direction: facing,
      destination,
    };
    player.animT = 0;
    player.row = 0;
    teleportEffects.push({ x: entryX, y: entryY, age: 0 });
    return true;
  }

  function updateTeleport(player) {
    const teleport = player.tp;
    if (++teleport.timer < CFG.teleportStepFrames) return;
    teleport.timer = 0;
    teleport.step++;
    if (teleport.step === 1) {
      teleportEffects.push({
        x: teleport.destination[0],
        y: teleport.destination[1],
        age: 0,
      });
    } else if (teleport.step === 2) {
      player.x = teleport.destination[0] << 8;
      player.y = teleport.destination[1] << 8;
    } else if (teleport.step >= 3) {
      player.tp = null;
      player.tpCooldown = CFG.teleportCooldown;
    }
  }

  function updateEnemies() {
    const targets = players.filter((p) => p.active && p.hp > 0);
    for (const e of enemies) {
      const ex = (e.x >> 8) + 4, ey = (e.y >> 8) + 4;
      let target = null, nearest = Infinity;
      for (const p of targets) {
        const dx = (p.x >> 8) + 8 - ex, dy = (p.y >> 8) + 9 - ey;
        const distance = dx * dx + dy * dy;
        if (distance < nearest) { nearest = distance; target = [dx, dy]; }
      }

      e.moving = false;
      const chaseRange = CFG.chaseRange * 8;
      const speedScale = e.speedScale || 1;
      if (!target || nearest > chaseRange * chaseRange) {
        if (e.wanderTimer <= 0) {
          if (Math.random() < 0.25) {
            e.wanderDir = -1;
            e.wanderTimer = 30 + ((Math.random() * 60) | 0);
          } else {
            e.wanderDir = (Math.random() * DIRS.length) | 0;
            e.wanderTimer = 40 + ((Math.random() * 80) | 0);
          }
        }
        e.wanderTimer--;
        if (e.wanderDir < 0) continue;

        const direction = DIRS[e.wanderDir];
        e.dir = e.wanderDir;
        let speed = Math.round(CFG.enemySpeed * CFG.wanderFactor * speedScale * 256);
        if (direction[0] && direction[1]) speed = (speed * DIAG) >> 8;
        e.moving = tryMove(
          e,
          direction[0] * speed,
          direction[1] * speed,
          EBOX,
          false,
          (x, y) => enemyBlocks(e, x, y)
        );
        if (e.moving) e.animT++;
        else e.wanderTimer = 0;
        continue;
      }

      if (nearest < 9) continue;
      const angle = Math.round(Math.atan2(target[1], target[0]) / (Math.PI / 4));
      e.dir = (5 + angle + 16) % 8;
      const direction = DIRS[e.dir];
      let speed = Math.round(CFG.enemySpeed * speedScale * 256);
      if (direction[0] && direction[1]) speed = (speed * DIAG) >> 8;
      e.moving = tryMove(
        e,
        direction[0] * speed,
        direction[1] * speed,
        EBOX,
        false,
        (x, y) => enemyBlocks(e, x, y)
      );
      if (e.moving) e.animT++;
    }
  }

  // ------------------------------------------------------------ Actualizacion
  function updatePlayer(p) {
    if (!p.active || p.hp <= 0) return;
    const held = input.held[p.id];
    const dx = ((held & BTN.RIGHT) ? 1 : 0) - ((held & BTN.LEFT) ? 1 : 0);
    const dy = ((held & BTN.DOWN) ? 1 : 0) - ((held & BTN.UP) ? 1 : 0);
    const moving = dx !== 0 || dy !== 0;
    const firing = (held & BTN.A) !== 0;

    if (p.hit > 0) p.hit--;
    if (p.tpCooldown > 0) p.tpCooldown--;
    if (p.tp) {
      updateTeleport(p);
      return;
    }

    if (p.pushing) p.facing = p.pushFacing;
    else if (!firing && moving) p.facing = DIR_INDEX[(dy + 1) * 3 + (dx + 1)];
    if ((input.pressed[p.id] & BTN.B) && p.tpCooldown === 0) {
      if (startTeleport(p, p.facing)) return;
    }

    if (moving) {
      let sp = Math.round(CFG.playerSpeed * 256);
      if (dx && dy) sp = (sp * DIAG) >> 8;
      tryMove(p, dx * sp, dy * sp, PBOX, true);
      p.animT++;
      if (p.pushing) {
        p.pushAnimT++;
        p.row = ((p.pushAnimT / CFG.pushAnimFrames) | 0) % 6;
      } else {
        p.pushAnimT = 0;
        p.row = 1 + (((p.animT / CFG.runAnimFrames) | 0) % 4);
      }
    } else if (p.pushing) {
      p.pushAnimT++;
      p.row = ((p.pushAnimT / CFG.pushAnimFrames) | 0) % 6;
    } else {
      p.pushAnimT = 0;
      p.animT = 0;
      p.row = 0;
    }

    if (p.cd > 0) p.cd--;
    if (firing && p.cd === 0) {
      const d = DIRS[p.facing];
      let vx = d[0] * CFG.bulletSpeed, vy = d[1] * CFG.bulletSpeed;
      if (d[0] && d[1]) { vx = (vx * DIAG) >> 8; vy = (vy * DIAG) >> 8; }
      const cx = (p.x >> 8) + 8, cy = (p.y >> 8) + 8;
      bullets.push({ x: cx * 256, y: cy * 256, vx, vy, life: CFG.bulletRange << 8 });
      p.cd = Math.max(1, Math.round(59.73 / CFG.fireRate));
    }

    const px = p.x >> 8;
    const py = p.y >> 8;
    const left = Math.max(0, (px + PBOX.x) >> 3);
    const right = Math.min(MAP_W - 1, (px + PBOX.x + PBOX.w - 1) >> 3);
    const top = Math.max(0, (py + PBOX.y) >> 3);
    const bottom = Math.min(MAP_H - 1, (py + PBOX.y + PBOX.h - 1) >> 3);
    for (let ty = top; ty <= bottom; ty++) {
      for (let tx = left; tx <= right; tx++) {
        const idx = ty * MAP_W + tx;
        if (itemsLayer[idx] === 26) {
          setItemTile(idx, -1);
          p.hp = Math.min(CFG.playerHp, p.hp + 1);
        } else if (itemsLayer[idx] === 25) {
          setItemTile(idx, -1);
          p.coins++;
        }
      }
    }

    if (p.inv > 0) p.inv--;
  }

  function update() {
    if (gameOver) {
      if ((input.pressed[0] | input.pressed[1]) & BTN.START) resetGame();
      return;
    }

    if (!players[1].active && input.held[1]) {
      const firstPlayer = players[0];
      const [joinX, joinY] = findFree(
        (firstPlayer.x >> 8) + 12,
        firstPlayer.y >> 8,
        PBOX,
        (x, y) => players.some((player) =>
          player.active &&
          player.hp > 0 &&
          overlap(x, y, PBOX, player.x >> 8, player.y >> 8, PBOX)
        )
      );
      players[1].x = joinX << 8;
      players[1].y = joinY << 8;
      players[1].active = true;
    }

    teleportEffects = teleportEffects.filter((effect) => {
      effect.age++;
      return effect.age < CFG.teleportEffectFrames;
    });
    for (const [idx, timer] of blasts) {
      if (timer <= 1) blasts.delete(idx);
      else blasts.set(idx, timer - 1);
    }

    updateInteractives();
    for (const p of players) updatePlayer(p);

    const live = players.filter(p => p.active && p.hp > 0);
    if (live.length) {
      let mx = 0, my = 0;
      for (const p of live) { mx += (p.x >> 8) + 8; my += (p.y >> 8) + 12; }
      mx /= live.length; my /= live.length;
      const tx = Math.max(0, Math.min(MAP_W * 8 - 160, Math.round(mx - 80)));
      const ty = Math.max(0, Math.min(MAP_H * 8 - VIEW_H, Math.round(my - VIEW_H / 2)));
      cam.x += Math.trunc((tx - cam.x) / 4);
      cam.y += Math.trunc((ty - cam.y) / 4);
    }

    // Proyectiles
    for (const b of bullets) {
      b.x += b.vx; b.y += b.vy;
      b.life -= Math.max(Math.abs(b.vx), Math.abs(b.vy));
      const bx = b.x >> 8, by = b.y >> 8;

      if (b.life <= 0) {
        b.dead = true;
        continue;
      }

      if (checkBulletHitItems(bx, by)) {
        b.dead = true;
        continue;
      }

      if (boxBlocked(bx, by, BBOX, true, false)) {
        b.dead = true;
        continue;
      }

      let detonated = false;
      for (const e of enemies) {
        if (e.hp <= 0) continue;
        const dx = (e.x >> 8) + 4 - bx;
        const dy = (e.y >> 8) + 4 - by;
        if (dx * dx + dy * dy <= CFG.fuseRadius * CFG.fuseRadius ||
            overlap(bx, by, BBOX, e.x >> 8, e.y >> 8, EBOX)) {
          explode(bx, by);
          b.dead = true;
          detonated = true;
          break;
        }
      }
      if (detonated) continue;
    }
    bullets = bullets.filter(b => !b.dead);
    enemies = enemies.filter(e => e.hp > 0);

    updateEnemies();
    for (const e of enemies) {
      if (e.hit > 0) e.hit--;
      for (const p of live) {
        if (!p.tp && p.inv === 0 && overlap(p.x >> 8, p.y >> 8, PBOX, e.x >> 8, e.y >> 8, EBOX)) {
          p.hp--;
          p.inv = CFG.invuln;
          p.hit = CFG.hurtFlash;
        }
      }
    }

    if (enemies.length === 0 && --waveTimer <= 0) spawnWave();
    if (!players.some(p => p.active && p.hp > 0)) gameOver = true;
  }

  function drawMapTile(ctx, tx, ty, tileId, attr) {
    if (tileId < 0) return;
    const screenX = tx * 8 - cam.x;
    const screenY = ty * 8 - cam.y;
    const sourceX = (tileId % 32) * 8;
    const sourceY = Math.floor(tileId / 32) * 8;
    const flags = attr || 0;
    ctx.save();
    ctx.translate(screenX + 4, screenY + 4);
    if (flags & 0x10) ctx.transform(0, 1, 1, 0, 0, 0);
    if (flags & 0x20) ctx.scale(-1, 1);
    if (flags & 0x40) ctx.scale(1, -1);
    ctx.drawImage(assets.tilesetImage, sourceX, sourceY, 8, 8, -4, -4, 8, 8);
    ctx.restore();
  }

  // ------------------------------------------------------------ Renderizado a color original
  function render() {
    const ctx = gbc.ctx;
    ctx.clearRect(0, 0, GBC_W, GBC_H);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, GBC_W, GBC_H);

    const firstTileX = Math.max(0, Math.floor(cam.x / 8));
    const lastTileX = Math.min(MAP_W - 1, Math.floor((cam.x + GBC_W - 1) / 8));
    const firstTileY = Math.max(0, Math.floor(cam.y / 8));
    const lastTileY = Math.min(MAP_H - 1, Math.floor((cam.y + GBC_H - 1) / 8));

    for (let ty = firstTileY; ty <= lastTileY; ty++) {
      for (let tx = firstTileX; tx <= lastTileX; tx++) {
        const idx = ty * MAP_W + tx;
        drawMapTile(ctx, tx, ty, fondoLayer[idx], fondoAttrs[idx]);
      }
    }
    for (let ty = firstTileY; ty <= lastTileY; ty++) {
      for (let tx = firstTileX; tx <= lastTileX; tx++) {
        const idx = ty * MAP_W + tx;
        if (itemsLayer[idx] >= 0) drawMapTile(ctx, tx, ty, itemsLayer[idx], itemsAttrs[idx]);
      }
    }

    for (const [idx, timer] of blasts) {
      const tx = idx % MAP_W;
      const ty = Math.floor(idx / MAP_W);
      if (tx < firstTileX || tx > lastTileX || ty < firstTileY || ty > lastTileY) continue;
      ctx.save();
      ctx.globalAlpha = (timer / CFG.blastFrames) * 0.55;
      ctx.fillStyle = "#ff9b22";
      ctx.fillRect(tx * 8 - cam.x, ty * 8 - cam.y, 8, 8);
      ctx.restore();
    }

    for (const effect of teleportEffects) {
      const spriteFrame = Math.min(7, Math.floor(effect.age / 2));
      ctx.drawImage(
        assets.teleportImage,
        spriteFrame * 16, 0, 16, 16,
        effect.x - cam.x, effect.y - cam.y, 16, 16
      );
    }

    for (const p of players) {
      if (!p.active || p.hp <= 0) continue;
      if (p.inv > 0 && !(p.hit > 0) && ((frame >> 2) & 1)) continue;
      const px = (p.x >> 8) - cam.x;
      const py = (p.y >> 8) - cam.y;
      if (p.tp && p.tp.step === 1) continue;
      if (p.tp) ctx.globalAlpha = 0.55;
      const spriteColumn = p.pushing ? 8 : p.facing;
      ctx.drawImage(assets.playerImage, spriteColumn * 16, p.row * 16, 16, 16, px, py, 16, 16);
      if (p.tp) ctx.globalAlpha = 1;
    }

    for (const b of bullets) {
      ctx.fillStyle = "#fff";
      ctx.fillRect((b.x >> 8) - cam.x - 2, (b.y >> 8) - cam.y - 2, 4, 4);
    }

    for (const e of enemies) {
      const px = (e.x >> 8) - cam.x, py = (e.y >> 8) - cam.y;
      const frameIndex = e.moving ? ((e.animT / CFG.enemyAnimFrames) | 0) & 1 : 0;
      ctx.drawImage(assets.enemyImage, e.dir * 8, frameIndex * 8, 8, 8, px, py, 8, 8);
    }

    const status = players.map((p) => p.active ? `J${p.id + 1} HP ${p.hp} $ ${p.coins}` : `J${p.id + 1} -`).join("   ");
    document.getElementById("info").textContent = gameOver ? "GAME OVER · Enter para reiniciar" :
      `${paused ? "PAUSA · " : ""}${status}   Oleada ${wave}   Enemigos ${enemies.length}`;
  }

  // ------------------------------------------------------------ Inicializacion
  async function start() {
    assets = await DMGLoader.init();
    MAP_W = assets.itemsMap.w;
    MAP_H = assets.itemsMap.h;
    itemsLayer = assets.itemsMap.data.slice();
    itemsAttrs = assets.itemsMap.attrs.slice();
    initialItemsLayer = itemsLayer.slice();
    initialItemsAttrs = itemsAttrs.slice();
    fondoLayer = assets.backgroundMap.data.slice();
    fondoAttrs = assets.backgroundMap.attrs.slice();

    gbc.ctx.imageSmoothingEnabled = false;

    for (let i = 0; i < MAP_W * MAP_H; i++) syncMapCell(i);

    resetGame();
    input.extraKeyHandlers.KeyP = () => { paused = !paused; };

    const STEP = 1000 / 59.73;
    let last = performance.now(), acc = 0;

    function loop(now) {
      acc += Math.min(now - last, 100);
      last = now;
      while (acc >= STEP) {
        acc -= STEP;
        if (!paused) {
          input.poll();
          update();
          frame++;
        }
      }
      render();
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  }

  start().catch((error) => {
    console.error("No se pudo iniciar el juego:", error);
    document.getElementById("info").textContent = `Error al iniciar: ${error.message}`;
  });
})();