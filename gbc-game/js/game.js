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
    chaseRange: 6,
    blastRadius: 2,
    fuseRadius: 8,
    blastFrames: 10,
    wanderFactor: 0.5,
    speedJitter: 0.10,
    tpDistance: 2,
    tpAhead: 8,
    tpStepFrames: 4,
    portalHold: 5,
    tpCooldown: 40,
    hurtFlash: 6,
    bulletSpeed: 3 * 256,
    bulletRange: 120,
    fireRate: 2.5,
    waveBase: 3,
    wavePerWave: 1,
    waveMax: 12,
    playerHp: 3,
    enemyHp: 2,
    invuln: 90,
    runAnimFrames: 6,
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

  function syncMapCell(idx) {
    const itemTile = itemsLayer[idx];
    const hasItem = itemTile >= 0;
    const tileId = hasItem ? itemTile : fondoLayer[idx];
    gbc.mapTile[0][idx] = tileId >= 0 ? tileId : 0;
    gbc.mapAttr[0][idx] = hasItem ? itemsAttrs[idx] : fondoAttrs[idx];
  }

  function setItemTile(idx, gid) {
    itemsLayer[idx] = gid;
    itemsAttrs[idx] = 0;
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
        // 29: Esquina superior izquierda de caja de monedas (29, 61 con mirror)
        else if (t === 29 && tx + 1 < MAP_W && ty + 1 < MAP_H) {
          coinChests.push({ tx, ty, pushTime: 0, opened: false });
        }
        // 65: Puerta horizontal
        else if (t === 65 && tx + 1 < MAP_W && ty + 1 < MAP_H) {
          doors.push({ tx, ty, pushTime: 0, open: false, isVertical: false });
        }
      }
    }
  }

  function updateInteractives() {
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
          if (p.active && p.hp > 0 && p.inv === 0 && overlap(p.x >> 8, p.y >> 8, PBOX, sBox.x, sBox.y, sBox)) {
            p.hp--;
            p.inv = CFG.invuln;
            p.hit = CFG.hurtFlash;
          }
        }
        for (const e of enemies) {
          if (e.hp > 0 && overlap(e.x >> 8, e.y >> 8, EBOX, sBox.x, sBox.y, sBox)) {
            e.hp--;
            e.hit = CFG.hurtFlash;
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
      let pushing = false;
      const cBox = { x: c.tx * 8 - 2, y: c.ty * 8 - 2, w: 20, h: 20 };
      for (const p of players) {
        if (p.active && p.hp > 0 && overlap(p.x >> 8, p.y >> 8, PBOX, cBox.x, cBox.y, cBox)) {
          pushing = true;
        }
      }
      if (pushing) {
        c.pushTime++;
        if (c.pushTime >= 90) { // 1.5s empujando para abrir
          c.opened = true;
          players[0].coins += 5;
          const idx = c.ty * MAP_W + c.tx;
          setItemTile(idx, -1);
          setItemTile(idx + 1, 25);
          setItemTile(idx + MAP_W, 25);
          setItemTile(idx + MAP_W + 1, -1);
        }
      } else {
        c.pushTime = Math.max(0, c.pushTime - 1);
      }
    }

    // C) PUERTAS EMPUJABLES (64, 65, 96, 97 -> 66, 67, 98, 99 -> Vertical: 68, 69, 70)
    for (const d of doors) {
      if (d.open) {
        let pushingV = false;
        const vBox = { x: d.tx * 8 - 2, y: (d.ty - 1) * 8, w: 12, h: 28 };
        for (const p of players) {
          if (p.active && overlap(p.x >> 8, p.y >> 8, PBOX, vBox.x, vBox.y, vBox)) pushingV = true;
        }
        const bY = d.ty + 1;
        if (pushingV) {
          setItemTile((bY - 1) * MAP_W + d.tx, 100);
          setItemTile((bY - 2) * MAP_W + d.tx, 101);
        } else {
          setItemTile((bY - 1) * MAP_W + d.tx, 69);
          setItemTile((bY - 2) * MAP_W + d.tx, 70);
        }
        continue;
      }

      let pushingH = false;
      const hBox = { x: d.tx * 8 - 2, y: d.ty * 8 - 2, w: 20, h: 20 };
      for (const p of players) {
        if (p.active && overlap(p.x >> 8, p.y >> 8, PBOX, hBox.x, hBox.y, hBox)) pushingH = true;
      }

      const idx = d.ty * MAP_W + d.tx;
      if (pushingH) {
        d.pushTime++;
        setItemTile(idx, 66);
        setItemTile(idx + 1, 67);
        setItemTile(idx + MAP_W, 98);
        setItemTile(idx + MAP_W + 1, 99);

        if (d.pushTime >= 90) { // Se abre y pasa a vertical
          d.open = true;
          setItemTile(idx, -1);
          setItemTile(idx + 1, -1);
          setItemTile(idx + MAP_W, -1);
          setItemTile(idx + MAP_W + 1, -1);

          const bY = d.ty + 1;
          setItemTile(bY * MAP_W + d.tx, 68);
          setItemTile((bY - 1) * MAP_W + d.tx, 69);
          setItemTile((bY - 2) * MAP_W + d.tx, 70);
        }
      } else if (d.pushTime > 0) {
        d.pushTime = 0;
        setItemTile(idx, 65);
        setItemTile(idx + 1, 64);
        setItemTile(idx + MAP_W, 97);
        setItemTile(idx + MAP_W + 1, 96);
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

  function overlap(ax, ay, a, bx, by, b) {
    return ax + a.x < bx + b.x + b.w && ax + a.x + a.w > bx + b.x &&
           ay + a.y < by + b.y + b.h && ay + a.y + a.h > by + b.y;
  }

  function newPlayer(i, x, y) {
    return { id: i, x: x << 8, y: y << 8, facing: 7, hp: CFG.playerHp, coins: 0, cd: 0,
             inv: 0, animT: 0, row: 0, active: i === 0, hit: 0 };
  }

  function resetGame() {
    players = [newPlayer(0, 120, 160), newPlayer(1, 160, 160)];
    enemies = [];
    bullets = [];
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
          enemies.push({ x: x << 8, y: y << 8, hp: CFG.enemyHp, animT: 0, moving: false, dir: 0, wanderDir: 0, wanderTimer: 0 });
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

      if (target && nearest < 9) {
        e.moving = false;
        continue;
      }

      let direction;
      if (target && nearest <= (CFG.chaseRange * 8) ** 2) {
        direction = DIRS[DIR_INDEX[(Math.sign(target[1]) + 1) * 3 + Math.sign(target[0]) + 1]];
      } else {
        if (e.wanderTimer <= 0) {
          e.wanderDir = (Math.random() * DIRS.length) | 0;
          e.wanderTimer = 30 + ((Math.random() * 60) | 0);
        }
        e.wanderTimer--;
        direction = DIRS[e.wanderDir];
      }

      const speed = Math.max(1, Math.round(CFG.enemySpeed * 256));
      e.dir = DIR_INDEX[(direction[1] + 1) * 3 + direction[0] + 1];
      let dx = direction[0] * speed, dy = direction[1] * speed;
      if (dx && dy) { dx = (dx * DIAG) >> 8; dy = (dy * DIAG) >> 8; }
      e.moving = tryMove(e, dx, dy, EBOX, false);
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
    if (!firing && moving) p.facing = DIR_INDEX[(dy + 1) * 3 + (dx + 1)];

    if (moving) {
      let sp = Math.round(CFG.playerSpeed * 256);
      if (dx && dy) sp = (sp * DIAG) >> 8;
      tryMove(p, dx * sp, dy * sp, PBOX, true);
      p.animT++;
      p.row = 1 + (((p.animT / CFG.runAnimFrames) | 0) % 4);
    } else {
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

    // Recogida de lata (26) y monedas (25)
    const tx = ((p.x >> 8) + 8) >> 3;
    const ty = ((p.y >> 8) + 10) >> 3;
    const pIdx = ty * MAP_W + tx;
    if (itemsLayer[pIdx] === 26) {
      setItemTile(pIdx, -1);
      p.hp = Math.min(CFG.playerHp, p.hp + 1);
    } else if (itemsLayer[pIdx] === 25) {
      setItemTile(pIdx, -1);
      p.coins++;
    }

    if (p.inv > 0) p.inv--;
  }

  function update() {
    if (gameOver) {
      if ((input.pressed[0] | input.pressed[1]) & BTN.START) resetGame();
      return;
    }

    if (!players[1].active && input.held[1]) {
      players[1].active = true;
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

      if (b.life <= 0 || boxBlocked(bx, by, BBOX, true, false)) {
        b.dead = true;
        continue;
      }

      if (checkBulletHitItems(bx, by)) {
        b.dead = true;
        continue;
      }

      for (const e of enemies) {
        if (e.hp > 0 && overlap(bx, by, BBOX, e.x >> 8, e.y >> 8, EBOX)) {
          b.dead = true;
          e.hp--;
          e.hit = CFG.hurtFlash;
          break;
        }
      }
    }
    bullets = bullets.filter(b => !b.dead);
    enemies = enemies.filter(e => e.hp > 0);

    updateEnemies();
    for (const e of enemies) {
      if (e.hit > 0) e.hit--;
      for (const p of live) {
        if (p.inv === 0 && overlap(p.x >> 8, p.y >> 8, PBOX, e.x >> 8, e.y >> 8, EBOX)) {
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

    for (const p of players) {
      if (!p.active || p.hp <= 0) continue;
      if (p.inv > 0 && !(p.hit > 0) && ((frame >> 2) & 1)) continue;
      const px = (p.x >> 8) - cam.x;
      const py = (p.y >> 8) - cam.y;
      ctx.drawImage(assets.playerImage, p.facing * 16, p.row * 16, 16, 16, px, py, 16, 16);
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

    const status = players.map((p) => p.active ? `J${p.id + 1} HP ${p.hp}` : `J${p.id + 1} -`).join("   ");
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