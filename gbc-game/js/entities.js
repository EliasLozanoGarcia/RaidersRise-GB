"use strict";
/* Entidades: jugador, enemigos, oleadas, balas, teletransporte y especiales. */

function newPlayer(i, x, y) {
  const ch = CHARS[chars[i]];
  const p = { id: i, ch, x: x << 8, y: y << 8, facing: 7, hp: 0, coins: 0, crystals: 0, keys: 0, grenades: 0, shield: 0, cd: 0, ammo: 0, reloadT: 0, mana: CFG.specialCharge, sp: null,
             inv: 0, animT: 0, row: 0, active: i === 0, hit: 0, tpCooldown: 0, slash: 0,
             pushing: false, pushFacing: 7, pushAnimT: 0 };
  p.hp = maxHp(p);
  p.ammo = ammoMax(p);
  return p;
}

function spawnEnemyAt(tileX, tileY, typeName, spawnPoint) {
  const type = CFG.enemyTypes[typeName];
  const box = type.size === 8 ? EBOX : { x: 2, y: 2, w: type.size - 4, h: type.size - 4 };
  for (let radius = 0; radius < Math.max(MAP_W, MAP_H); radius++) {
    for (let oy = -radius; oy <= radius; oy++) {
      for (let ox = -radius; ox <= radius; ox++) {
        if (radius && Math.abs(ox) !== radius && Math.abs(oy) !== radius) continue;
        const x = (tileX + ox) * 8;
        const y = (tileY + oy) * 8;
        if (boxBlocked(x, y, box, type.flying) || enemies.some((e) => overlap(x, y, box, e.x >> 8, e.y >> 8, e.box))) continue;
        enemies.push({
          x: x << 8,
          y: y << 8,
          type: typeName,
          spawnPoint,
          size: type.size,
          box,
          flying: type.flying,
          sprite: type.sprite,
          speedMul: type.speed,
          ai: type.ai,
          coin: type.coin,
          sheet: type.sheet,
          hp: type.hp,
          animT: 0,
          moving: false,
          dir: 7,
          speedScale: 256 + rnd(2 * CFG.speedJitter + 1) - CFG.speedJitter,
          wanderDir: -1,
          wanderTimer: 0,
        });
        return true;
      }
    }
  }
  return false;
}

function pickEnemyType() {
  const entries = Object.entries(CFG.enemyTypes);
  let total = 0;
  for (const [, t] of entries) total += t.weight;
  let r = rnd(total);
  for (const [name, t] of entries) {
    if ((r -= t.weight) < 0) return name;
  }
  return entries[0][0];
}

function initSpawnPoints() {
  const normal = (levelLogic && (levelLogic.spawners || levelLogic.enemies)) || [];
  const custom = (levelLogic && levelLogic.customSpawners) || [];
  spawnPoints = normal.map((r, index) => ({
    x: r[0], y: r[1], w: r[2] || 16, h: r[3] || 16,
    normalIndex: index, normalCount: normal.length
  })).concat(custom.map((r) => ({
    x: r.x, y: r.y, w: r.w || 16, h: r.h || 16, type: r.type, count: r.count || 1
  })));
  if (!spawnPoints.length) {
    console.warn("Este nivel no tiene áreas de spawn definidas en su archivo Logic.");
    return;
  }
  spawnPoints.forEach((point) => {
    point.limit = wavesPerPoint(level);
    point.wave = 0;
    point.pending = 0;
    point.timer = 60;
  });
}

function spawnPointCount(point) {
  if (point.count !== undefined) return point.count;
  const cycle = Math.floor((level - 1) / 9);
  const total = Math.min(CFG.waveBase + cycle * 20 + (point.wave - 1) * CFG.wavePerWave, CFG.waveMax + cycle * 20);
  return Math.floor(total / point.normalCount) + (point.normalIndex < total % point.normalCount ? 1 : 0);
}

function updateSpawnPoints() {
  for (const point of spawnPoints) {
    if (point.pending === 0 && enemies.some((e) => e.hp > 0 && e.spawnPoint === point)) continue;
    if (point.pending === 0 && point.wave >= point.limit) continue;
    if (point.timer > 0 && --point.timer > 0) continue;
    if (point.pending === 0) {
      point.wave++;
      wave = Math.max(wave, point.wave);
      point.pending = spawnPointCount(point);
      if (point.pending === 0) { point.timer = CFG.wavePause; continue; }
    }
    const attempts = point.pending * 4;
    for (let i = 0; i < attempts && point.pending > 0; i++) {
      const tileX = (point.x + rnd(point.w)) >> 3, tileY = (point.y + rnd(point.h)) >> 3;
      const px = tileX * 8, py = tileY * 8;
      if (players.some((p) => p.active && p.hp > 0 && Math.abs((p.x >> 8) - px) < 48 && Math.abs((p.y >> 8) - py) < 48)) continue;
      if (spawnEnemyAt(tileX, tileY, point.type || pickEnemyType(), point)) point.pending--;
    }
    if (point.pending > 0 && !point.warned) {
      console.warn(`No se pudieron generar todos los enemigos del punto (${point.x}, ${point.y}); se reintentará.`);
      point.warned = true;
    } else if (point.pending === 0) point.warned = false;
    point.timer = point.pending > 0 ? 30 : CFG.wavePause;
  }
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
        spawnCoins([idx]);
        return;
      }
    }
  }
}

function damageEnemy(enemy, amount) {
  if (enemy.hp <= 0) return;
  enemy.hp = Math.max(0, enemy.hp - amount);
  enemy.hit = CFG.hurtFlash;
  if (enemy.hp === 0) {
    if (enemy.coin && rnd(10) < coinChanceTenths()) dropCoin(enemy);
    stats.kills++; sfx("enemyDie");
  } else sfx("hit");
}

function explode(cx, cy) {
  const radius = blastRadius();
  for (const enemy of enemies) {
    if (enemy.hp <= 0) continue;
    const dx = (enemy.x >> 8) + 4 - cx;
    const dy = (enemy.y >> 8) + 4 - cy;
    if (dx * dx + dy * dy <= radius * radius) damageEnemy(enemy, 1 + lv("dmg"));
  }

  for (let ty = (cy - radius) >> 3; ty <= (cy + radius) >> 3; ty++) {
    for (let tx = (cx - radius) >> 3; tx <= (cx + radius) >> 3; tx++) {
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
  const [unitX, unitY] = DIRU[facing];
  const centerX = (player.x >> 8) + 8;
  const centerY = (player.y >> 8) + 9;
  const distance = CFG.teleportDistance * 8;
  const candidates = [];
  for (let radius = distance; radius <= distance + 24; radius += 2) candidates.push(radius);
  for (let radius = distance - 2; radius >= 4; radius -= 2) candidates.push(radius);

  let destination = null;
  for (const radius of candidates) {
    const x = centerX + ((unitX * radius + 128) >> 8) - 8;
    const y = centerY + ((unitY * radius + 128) >> 8) - 9;
    if (!boxBlocked(x, y, PBOX, false, true)) {
      destination = [x, y];
      break;
    }
  }
  if (!destination) return false;

  const offset = CFG.teleportOffset || 8;
  const offX = (unitX * offset + 128) >> 8;
  const offY = (unitY * offset + 128) >> 8;
  const entryX = player.x >> 8;
  const entryY = player.y >> 8;
  player.facing = facing;
  player.tp = {
    step: 0,
    timer: 0,
    direction: facing,
    destination,
    offX,
    offY,
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
    const isUp = DIRU[teleport.direction][1] < 0;
    teleportEffects.push({
      x: teleport.destination[0] - teleport.offX,
      y: teleport.destination[1] - teleport.offY,
      age: 0,
      overPlayer: isUp,
    });
  } else if (teleport.step === 2) {
    player.x = teleport.destination[0] << 8;
    player.y = teleport.destination[1] << 8;
  } else if (teleport.step >= 3) {
    player.tp = null;
    player.tpCooldown = CFG.teleportCooldown;
  }
}

function updateBee(e, target) {
  e.t = (e.t || 0) + 1;
  if (e.heading === undefined) { e.heading = rnd(256); e.phase = rnd(256); e.turnT = 0; e.turn = 0; }
  if (--e.turnT <= 0) {
    e.turnT = 8 + rnd(25);
    e.turn = rnd(11) - 5;
  }
  let desired = e.heading;
  const chase = target && target[0] * target[0] + target[1] * target[1] <= (chaseRangePixels() * 2) ** 2;
  if (chase) {
    const toward = atan2b(target[1], target[0]);
    const diff = ((toward - e.heading + 128) & 255) - 128;
    desired = e.heading + Math.max(-5, Math.min(5, diff));
  }
  e.heading = (desired + e.turn + ((sinb(e.t * 8 + e.phase) * 7) >> 8)) & 255;
  const speed = mulf(mulf(CFG.enemySpeed, e.speedMul), e.speedScale);
  const vx = (cosb(e.heading) * speed + 128) >> 8, vy = (sinb(e.heading) * speed + 128) >> 8;
  if (!tryMove(e, vx, 0, e.box, false, (x, y) => enemyBlocks(e, x, y))) e.heading = (128 - e.heading + rnd(41) - 20) & 255;
  if (!tryMove(e, 0, vy, e.box, false, (x, y) => enemyBlocks(e, x, y))) e.heading = (-e.heading + rnd(41) - 20) & 255;
  e.moving = true;
  e.animT += 2;
  e.dir = dirFromAngle(atan2b(vy, vx));
}

const chaseRangePixels = () => mulf(CFG.chaseRange * 8, aggressionMultiplier(level));

function updateEnemies() {
  const targets = players.filter((p) => p.active && p.hp > 0);
  for (const e of enemies) {
    const half = e.size >> 1;
    const ex = (e.x >> 8) + half, ey = (e.y >> 8) + half;
    let target = null, nearest = Infinity;
    for (const p of targets) {
      const dx = (p.x >> 8) + 8 - ex, dy = (p.y >> 8) + 9 - ey;
      const distance = dx * dx + dy * dy;
      if (distance < nearest) { nearest = distance; target = [dx, dy]; }
    }

    e.moving = false;
    if (e.ai === "fly") { updateBee(e, target); continue; }
    const chaseRange = chaseRangePixels();
    const speedScale = mulf(e.speedScale, e.speedMul);
    if (!target || nearest > chaseRange * chaseRange) {
      if (e.wanderTimer <= 0) {
        if (rnd(4) === 0) {
          e.wanderDir = -1;
          e.wanderTimer = 30 + rnd(60);
        } else {
          e.wanderDir = rnd(DIRS.length);
          e.wanderTimer = 40 + rnd(80);
        }
      }
      e.wanderTimer--;
      if (e.wanderDir < 0) continue;

      const direction = DIRS[e.wanderDir];
      e.dir = e.wanderDir;
      let speed = mulf(mulf(CFG.enemySpeed, CFG.wanderFactor), speedScale);
      if (direction[0] && direction[1]) speed = (speed * DIAG) >> 8;
      e.moving = tryMove(
        e,
        direction[0] * speed,
        direction[1] * speed,
        e.box,
        false,
        (x, y) => enemyBlocks(e, x, y)
      );
      if (e.moving) e.animT++;
      else e.wanderTimer = 0;
      continue;
    }

    if (nearest < 9 + (half - 4) * (half - 4)) continue;
    e.dir = dirFromAngle(atan2b(target[1], target[0]));
    const direction = DIRS[e.dir];
    let speed = mulf(CFG.enemySpeed, speedScale);
    if (direction[0] && direction[1]) speed = (speed * DIAG) >> 8;
    e.moving = tryMove(
      e,
      direction[0] * speed,
      direction[1] * speed,
      e.box,
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
  unstickPlayer(p, false);

  if (!firing) p.aim = null;
  else if (p.aim == null && !p.pushing) p.aim = p.facing;
  if (p.pushing) {
    if (firing && p.aim == null) p.aim = p.facing;
    p.facing = p.pushFacing;
  } else if (firing && p.aim != null) p.facing = p.aim;
  else if (!firing && moving) p.facing = DIR_INDEX[(dy + 1) * 3 + (dx + 1)];
  
  if (p.dash) {
    const dd = p.dash;
    const step = dd.d[0] && dd.d[1] ? 181 : 256;
    for (let k = 0; k < 4 && dd.left > 0; k++) {
      const a = tryMove(p, dd.d[0] * step, 0, PBOX, true);
      const b = tryMove(p, 0, dd.d[1] * step, PBOX, true);
      if (!a && !b) { dd.left = 0; break; }
      dd.left -= 1;
    }
    p.row = 5 + (((frame / 2) | 0) % 4);
    if (dd.left <= 0) p.dash = null;
    if (p.inv > 0) p.inv--;
    return;
  }
  if ((input.pressed[p.id] & BTN.B) && p.tpCooldown === 0) {
    if (p.ch.dash) {
      p.dash = { d: DIRS[p.facing], left: 24 };
      p.tpCooldown = CFG.teleportCooldown;
      sfx("teleport");
      return;
    }
    if (startTeleport(p, p.facing)) { sfx("teleport"); return; }
  }

  if (moving) {
    let sp = playerSpeed(p);
    if (dx && dy) sp = (sp * DIAG) >> 8;
    tryMove(p, dx * sp, dy * sp, PBOX, true);
  }

  if (p.pushAnim) {
    p.pushAnimT++;
    const hold = p.pushAnim === "up" ? CFG.pushUpFrames : CFG.pushSideFrames;
    p.row = (p.pushAnim === "up" ? 0 : 2) + (((p.pushAnimT / hold) | 0) % 2);
    if (moving) p.animT++;
  } else if (moving) {
    p.pushAnimT = 0;
    p.animT++;
    p.row = 1 + (((p.animT / CFG.runAnimFrames) | 0) % 4);
  } else {
    p.pushAnimT = 0;
    p.animT = 0;
    p.row = 0;
  }

  if (p.cd > 0) p.cd--;
  if (p.slash > 0) p.slash--;
  if (p.reloadT > 0 && --p.reloadT === 0) { p.ammo = ammoMax(p); sfx("reload"); }
  
  if (firing && p.cd === 0 && p.reloadT === 0) {
    const d = DIRS[p.facing], u = DIRU[p.facing];
    if (p.ch.weapon === "sword") {
      const cx = (p.x >> 8) + 8 + ((u[0] * 12 + 128) >> 8), cy = (p.y >> 8) + 12 + ((u[1] * 12 + 128) >> 8);
      const r = { x: cx - 8, y: cy - 8, w: 16, h: 16 };
      p.slashRect = r;
      p.slash = 4;
      for (const e of enemies) {
        if (e.hp > 0 && overlap(e.x >> 8, e.y >> 8, e.box, 0, 0, r)) damageEnemy(e, 1 + lv("dmg"));
      }
      for (const [ox, oy] of [[2, 2], [10, 2], [2, 10], [10, 10]]) checkBulletHitItems(r.x + ox + 2, r.y + oy + 2);
      p.cd = fireDelay(p);
      sfx("hit");
      stats.shots++;
    } else {
      let vx = (u[0] * CFG.bulletSpeed) >> 8, vy = (u[1] * CFG.bulletSpeed) >> 8;
      const gun = p.ch.weapon === "gun";
      
      let bulletFrame = 2;
      let mirror = false;
      const ax = Math.abs(vx), ay = Math.abs(vy);
      if (ay > ax * 2) {
        bulletFrame = 0;
      } else if (ax > 0 && ay > 0) {
        bulletFrame = 1;
        if ((vx > 0 && vy < 0) || (vx < 0 && vy > 0)) mirror = true;
      }

      if (gun) {
        const a = DIR_ANG[p.facing] + rnd(25) - 12;
        vx = (cosb(a) * CFG.bulletSpeed) >> 8; vy = (sinb(a) * CFG.bulletSpeed) >> 8;
      } else {
        tryMove(p, -d[0] * 256, -d[1] * 256, PBOX, true);
      }
   // Seleccionamos la tabla correcta según si el personaje usa ametralladora (Kurt) o no
     // Identificamos a Kurt directamente por su ID de imagen
      const currentTipTable = (p.ch.img === "kurtImage") ? GUN_TIP : BAZOOKA_TIP;
      const tip = currentTipTable[p.facing][p.row % 2 ? 1 : 0];
    
      
      bullets.push({
        x: ((p.x >> 8) + tip[0]) * 256 + 128, 
        y: ((p.y >> 8) + tip[1]) * 256 + 128, 
        vx, vy, 
        life: bulletRange() << 8, 
        direct: gun, 
        bulletFrame, 
        mirror, 
        img: gun ? "shotSmallImage" : "shotBigImage" 
      });
      p.cd = fireDelay(p);
      if (!gun || stats.shots % 3 === 0) sfx("shot");
      stats.shots++;
      if (--p.ammo <= 0) { p.reloadT = reloadFrames(); sfx("empty"); }
    }
  }

  updateSpecial(p, held);

  const px = p.x >> 8;
  const py = p.y >> 8;
  const left = Math.max(0, (px + PBOX.x) >> 3);
  const right = Math.min(MAP_W - 1, (px + PBOX.x + PBOX.w - 1) >> 3);
  const top = Math.max(0, (py + PBOX.y) >> 3);
  const bottom = Math.min(MAP_H - 1, (py + PBOX.y + PBOX.h - 1) >> 3);
  
  for (let ty = top; ty <= bottom; ty++) {
    for (let tx = left; tx <= right; tx++) {
      const idx = ty * MAP_W + tx;

      collectPickup(p, idx);
    }
  }

  if (p.inv > 0) p.inv--;
}

function collectPickup(p, idx) {
  const item = itemsLayer[idx];
  if (!LUCKY_DROPS.includes(item) || (item === PICKUP.coin && coinWaiting(idx))) return;
  setItemTile(idx, -1);
  if (item === PICKUP.heart) p.hp = Math.min(maxHp(p), p.hp + 1);
  else if (item === PICKUP.coin) p.coins++;
  else if (item === PICKUP.mana) p.mana = Math.min(CFG.specialCharge, p.mana + Math.ceil(CFG.specialCharge / 10));
  else if (item === PICKUP.crystal) p.crystals++;
  else if (item === PICKUP.shield) p.shield = CFG.shieldFrames;
  else if (item === PICKUP.key) p.keys++;
  else if (item === PICKUP.grenade) p.grenades++;
  sfx(item === PICKUP.heart ? "heart" : "coin");
}

function specialRect(sp) {
  return { x: sp.tx * 8, y: sp.ty * 8, w: sp.w * 8, h: sp.h * 8 };
}

// Los IDs son indices locales del PNG, no los numeros de Tiled (que empiezan en 1).
function specialMarkerTile(x, y, w, h) {
  if (h === 1) return { id: x === 0 || x === w - 1 ? 90 : 91, attr: x === w - 1 && w > 1 ? 0x20 : 0 };
  if (w === 1) return { id: y === 0 || y === h - 1 ? 89 : 121, attr: y === h - 1 && h > 1 ? 0x40 : 0 };
  const left = x === 0, right = x === w - 1, top = y === 0, bottom = y === h - 1;
  if ((left || right) && (top || bottom)) return { id: 122, attr: (right ? 0x20 : 0) | (bottom ? 0x40 : 0) };
  if (left || right) return { id: 92, attr: right ? 0x20 : 0 };
  if (top || bottom) return { id: 123, attr: bottom ? 0x40 : 0 };
  return { id: 124, attr: 0 };
}

function specialFreeParts(tx, ty) {
  if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return [];
  const parts = [];
  const quadrant = { x: 0, y: 0, w: 4, h: 4 };
  for (const y of [0, 4]) for (const x of [0, 4]) {
    if (!boxBlocked(tx * 8 + x, ty * 8 + y, quadrant)) parts.push({ x, y });
  }
  return parts;
}

const specialFloor = (tx, ty) => specialFreeParts(tx, ty).length > 0;

// Limites en coordenadas diagonales u=x+y y v=x-y, en unidades de tile.
function diagonalArea(cx, cy, widthU, widthV) {
  const spanU = Math.max(2, 2 * Math.round(widthU / Math.SQRT2));
  const spanV = Math.max(2, 2 * Math.round(widthV / Math.SQRT2));
  const centerU = Math.round((cx + cy) / 8);
  let centerV = Math.round((cx - cy) / 8);
  if (((centerU - spanU / 2) - (centerV - spanV / 2)) % 2 !== 0) centerV++;
  return { minU: centerU - spanU / 2, maxU: centerU + spanU / 2,
    minV: centerV - spanV / 2, maxV: centerV + spanV / 2 };
}

function diagonalCells(area) {
  const cells = [];
  const minX = Math.floor((area.minU + area.minV) / 2);
  const maxX = Math.ceil((area.maxU + area.maxV) / 2);
  const minY = Math.floor((area.minU - area.maxV) / 2);
  const maxY = Math.ceil((area.maxU - area.minV) / 2);
  for (let ty = minY; ty < maxY; ty++) for (let tx = minX; tx < maxX; tx++) {
    const u = tx + ty + 1, v = tx - ty;
    if (u < area.minU || u > area.maxU || v < area.minV || v > area.maxV) continue;
    let attr = 0, edge = true;
    if (u === area.minU) attr = 0;
    else if (u === area.maxU) attr = 0x60;
    else if (v === area.minV) attr = 0x40;
    else if (v === area.maxV) attr = 0x20;
    else edge = false;
    cells.push({ tx, ty, id: edge ? 88 : 124, attr });
  }
  return cells;
}

function specialMarkerCells(sp) {
  if (sp.beam) return sp.cells;
  if (sp.diagonal) return diagonalCells(sp.diagonal).filter((cell) => specialFloor(cell.tx, cell.ty));
  const cells = [];
  for (let y = 0; y < sp.h; y++) for (let x = 0; x < sp.w; x++) {
    const tx = sp.tx + x, ty = sp.ty + y;
    if (specialFloor(tx, ty)) cells.push({ tx, ty, ...specialMarkerTile(x, y, sp.w, sp.h) });
  }
  return cells;
}

// Recorre los mismos pasos y limite de distancia que el proyectil real.
function aimBeam(p) {
  const u = DIRU[p.facing], s = CFG.bulletSpeed;
  const beam = {
    x: ((p.x >> 8) + 8) * 256, y: ((p.y >> 8) + 12) * 256,
    vx: (u[0] * s) >> 8, vy: (u[1] * s) >> 8, life: 480 << 8, beam: true
  };
  let x = beam.x, y = beam.y, life = beam.life;
  const cells = [], seen = new Set();
  while (life > 0) {
    x += beam.vx; y += beam.vy;
    life -= Math.max(Math.abs(beam.vx), Math.abs(beam.vy));
    if (life <= 0) break;
    const px = x >> 8, py = y >> 8, tx = px >> 3, ty = py >> 3;
    if (specialFloor(tx, ty)) {
      const idx = ty * MAP_W + tx;
      if (!seen.has(idx)) { seen.add(idx); cells.push({ tx, ty }); }
    }
    if (boxBlocked(px, py, BBOX, true, false)) break;
  }
  const vertical = Math.abs(beam.vy) > Math.abs(beam.vx);
  const reverse = vertical ? beam.vy < 0 : beam.vx < 0;
  const [dx, dy] = DIRS[p.facing];
  if (dx && dy && cells.length) {
    const first = cells[0], last = cells[cells.length - 1];
    const u0 = first.tx + first.ty + 1, v0 = first.tx - first.ty;
    const u1 = last.tx + last.ty + 1, v1 = last.tx - last.ty;
    const alongU = dx === dy;
    const start = alongU ? u0 : v0, end = alongU ? u1 : v1;
    const center = alongU ? v0 : u0;
    let minAlong = Math.min(start, end) - 1, maxAlong = Math.max(start, end) + 1;
    const minAcross = center - 1, maxAcross = center + 1;
    if ((minAlong - minAcross) % 2 !== 0) minAlong--;
    if ((maxAlong - minAcross) % 2 !== 0) maxAlong++;
    const area = alongU
      ? { minU: minAlong, maxU: maxAlong, minV: minAcross, maxV: maxAcross }
      : { minU: minAcross, maxU: maxAcross, minV: minAlong, maxV: maxAlong };
    return { state: "aim", beam, cells: diagonalCells(area).filter((cell) => specialFloor(cell.tx, cell.ty)) };
  }
  cells.forEach((cell, i) => {
    const pos = reverse ? cells.length - 1 - i : i;
    Object.assign(cell, specialMarkerTile(vertical ? 0 : pos, vertical ? pos : 0, vertical ? 1 : cells.length, vertical ? cells.length : 1));
  });
  return { state: "aim", beam, cells };
}

function updateSpecialExplosions() {
  specialExplosions = specialExplosions.filter((effect) => {
    effect.age++;
    return effect.age < 4 * CFG.specialExplosionFrameTicks;
  });
}

function specialHit(p, sp, mult, hurtPlayers) {
  const r = specialRect(sp);
  if (sp.diagonal) {
    const a = sp.diagonal;
    const intersects = (x, y, b) => {
      const l = x + b.x, t = y + b.y, right = l + b.w, bottom = t + b.h;
      return l + t < a.maxU * 8 && right + bottom > a.minU * 8 &&
        l - bottom < a.maxV * 8 && right - t > a.minV * 8 &&
        right > (a.minU + a.minV) * 4 && l < (a.maxU + a.maxV) * 4 &&
        bottom > (a.minU - a.maxV) * 4 && t < (a.maxU - a.minV) * 4;
    };
    for (const e of enemies) if (e.hp > 0 && intersects(e.x >> 8, e.y >> 8, e.box)) damageEnemy(e, specialDamage() * mult);
    for (const cell of diagonalCells(a)) {
      if (cell.tx >= 0 && cell.ty >= 0 && cell.tx < MAP_W && cell.ty < MAP_H)
        checkBulletHitItems(cell.tx * 8 + 4, cell.ty * 8 + 4);
    }
    if (hurtPlayers) for (const q of players) {
      if (q.active && q.hp > 0 && !q.tp && q.shield === 0 && intersects(q.x >> 8, q.y >> 8, PBOX)) {
        q.hp -= specialDamage();
        q.hit = CFG.hurtFlash;
      }
    }
    return;
  }
  for (const e of enemies) {
    if (e.hp > 0 && overlap(e.x >> 8, e.y >> 8, e.box, 0, 0, r)) damageEnemy(e, specialDamage() * mult);
  }
  for (let k = 0; k < sp.w * sp.h; k++) {
    checkBulletHitItems((sp.tx + (k % sp.w)) * 8 + 4, (sp.ty + ((k / sp.w) | 0)) * 8 + 4);
  }
  if (!hurtPlayers) return;
  for (const q of players) {
    if (q.active && q.hp > 0 && !q.tp && q.shield === 0 && overlap(q.x >> 8, q.y >> 8, PBOX, 0, 0, r)) {
      q.hp -= specialDamage();
      q.hit = CFG.hurtFlash;
    }
  }
}

function updateSpecial(p, held) {
  const sel = (held & BTN.SELECT) !== 0;
  const ult = p.ch.ult;
  if (ult === "beam") {
    if (sel && (p.sp || p.mana >= CFG.specialCharge)) {
      p.sp = aimBeam(p);
    } else if (p.sp) {
      bullets.push(p.sp.beam);
      p.sp = null;
      p.mana = 0;
      sfx("special");
    } else if (p.mana < CFG.specialCharge) {
      p.mana = Math.min(CFG.specialCharge, p.mana + manaRegen());
    }
    return;
  }
  if (p.sp && p.sp.state === "active") {
    const sp = p.sp;
    if (sp.instant) {
      if (++sp.t >= 16) p.sp = null;
      return;
    }
    if (++sp.t % CFG.specialTickFrames === 0) specialHit(p, sp, 1, true);
    if (sp.t >= specialFrames()) p.sp = null;
    return;
  }
  if (sel && (p.sp || p.mana >= CFG.specialCharge)) {
    const d = DIRS[p.facing], u = DIRU[p.facing];
    let w = specialSize(), h = w;
    if (ult === "burst") {
      const long = 5 + lv("spArea");
      // Kurt ultimate: área girada 90 grados
      [w, h] = d[0] ? [2, long] : [long, 2];
    }
    const dist = (d[0] ? w : h) * 4 + 8;
    const cx = (p.x >> 8) + 8 + ((u[0] * dist + 128) >> 8);
    const cy = (p.y >> 8) + 9 + ((u[1] * dist + 128) >> 8);
    p.sp = { state: "aim", w, h, tx: (cx >> 3) - (w >> 1), ty: (cy >> 3) - (h >> 1), t: 0 };
    if (d[0] && d[1]) {
      const long = ult === "burst" ? 5 + lv("spArea") : specialSize();
      const short = ult === "burst" ? 2 : long;
      p.sp.diagonal = diagonalArea(cx, cy, d[0] === d[1] ? short : long, d[0] === d[1] ? long : short);
    }
  } else if (p.sp) {
    if (ult === "burst") specialExplosions.push({ cells: specialMarkerCells(p.sp), age: 0 });
    p.sp.state = "active";
    p.sp.t = 0;
    p.mana = 0;
    sfx("special");
    if (ult === "burst") {
      p.sp.instant = true;
      specialHit(p, p.sp, 3, false);
      sfx("explosion");
    }
  } else if (p.mana < CFG.specialCharge) {
    p.mana = Math.min(CFG.specialCharge, p.mana + manaRegen());
  }
}

function continueGame() {
  const enemiesBeforeContinue = new Set(enemies.filter((e) => e.hp > 0).map((e) => e.spawnPoint));
  players.forEach((p, i) => {
    if (!p.active) return;
    p.hp = maxHp(p);
    [p.x, p.y] = startPos(i).map((v) => v << 8);
    p.inv = invulnFrames();
    p.shield = 0;
    p.hit = 0;
    p.tp = null;
    p.ammo = ammoMax(p);
    p.reloadT = 0;
    p.sp = null;
  });
  enemies = [];
  bullets = [];
  specialExplosions = [];
  for (const point of spawnPoints) {
    if (point.pending > 0 || enemiesBeforeContinue.has(point)) {
      point.pending = spawnPointCount(point);
      point.timer = 60;
    }
  }
  gameOver = false;
  goSel = 0;
}