"use strict";
/* Entidades: jugador, enemigos, oleadas, balas, teletransporte y especiales. */

function newPlayer(i, x, y) {
  const ch = CHARS[chars[i]];
  const p = { id: i, ch, x: x << 8, y: y << 8, facing: 7, hp: 0, coins: 0, crystals: 0, cd: 0, ammo: 0, reloadT: 0, mana: CFG.specialCharge, sp: null,
             inv: 0, animT: 0, row: 0, active: i === 0, hit: 0, tpCooldown: 0, slash: 0,
             pushing: false, pushFacing: 7, pushAnimT: 0 };
  p.hp = maxHp(p);
  p.ammo = ammoMax(p);
  return p;
}


const SPAWNS = [[10, 10], [20, 10], [12, 25], [22, 26], [8, 18], [18, 18], [26, 10], [6, 26]];

function spawnEnemyAt(tileX, tileY, typeName) {
  const type = CFG.enemyTypes[typeName];
  const box = type.size === 8 ? EBOX : { x: 2, y: 5, w: type.size - 4, h: type.size - 4 };
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
          size: type.size,
          box,
          flying: type.flying,
          sprite: type.sprite,
          speedMul: type.speed,
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

function spawnWave() {
  wave++;
  const cycle = ((level - 1) / layouts.length) | 0;
  const count = Math.min(CFG.waveBase + cycle * 20 + (wave - 1) * CFG.wavePerWave, CFG.waveMax + cycle * 20);
  let spawned = 0;
  
  // Obtenemos las zonas de spawn del nivel actual (comprobando 'spawners' o 'enemies' según tu JSON)
  const areas = levelLogic && (levelLogic.spawners || levelLogic.enemies);
  
  if (!areas || areas.length === 0) {
    console.warn("Este nivel no tiene áreas de spawn definidas en su archivo Logic.");
    return; // Si no hay áreas en el JSON, no spawnea fuera de ellas
  }

  for (let i = 0; i < count * 4 && spawned < count; i++) {
    // Elegimos una zona de spawn de las definidas en el JSON al azar o de forma cíclica
    const r = areas[rnd(areas.length)];
    
    // r format esperado en Tiled: [x, y, ancho, alto] en píxeles (o tiles)
    const tileX = (r[0] + rnd(r[2] || 16)) >> 3;
    const tileY = (r[1] + rnd(r[3] || 16)) >> 3;

    const px = tileX * 8, py = tileY * 8;
    
    // Evitar spawnear ENCIMA o muy cerca del jugador
    if (players.some((p) => p.active && p.hp > 0 && Math.abs((p.x >> 8) - px) < 48 && Math.abs((p.y >> 8) - py) < 48)) continue;
    
    if (spawnEnemyAt(tileX, tileY, pickEnemyType())) spawned++;
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
  if (enemy.hp === 0) { if (enemy.type !== "bee") dropCoin(enemy); stats.kills++; sfx("enemyDie"); } else sfx("hit");
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

  const entryX = centerX + ((unitX * 8 + 128) >> 8) - 8;
  const entryY = centerY + ((unitY * 8 + 128) >> 8) - 9;
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

// Abeja: vuelo err�tico. Rumbo continuo con bandazos sinusoidales, giros bruscos aleatorios y espiral alrededor del objetivo.
function updateBee(e, target) {
  e.t = (e.t || 0) + 1;
  if (e.heading === undefined) { e.heading = rnd(256); e.phase = rnd(256); e.turnT = 0; e.turn = 0; }
  if (--e.turnT <= 0) {
    e.turnT = 8 + rnd(25);
    e.turn = rnd(11) - 5;
  }
  let desired = e.heading;
  const chase = target && target[0] * target[0] + target[1] * target[1] <= (CFG.chaseRange * 8 * 2) ** 2;
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
    if (e.type === "bee") { updateBee(e, target); continue; }
    const chaseRange = CFG.chaseRange * 8;
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
  unstickPlayer(p, false); // si queda atrapado (muro o fuera del mapa), lo empuja hacia un hueco libre

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
    p.row = 1 + (((frame / 2) | 0) % 4);
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
    // Arriba: filas 0-1 a 0,15 s; lateral: filas 2-3 a 0,5 s (izquierda = volteado).
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
      if (gun) {
        const a = DIR_ANG[p.facing] + rnd(25) - 12;
        vx = (cosb(a) * CFG.bulletSpeed) >> 8; vy = (sinb(a) * CFG.bulletSpeed) >> 8;
      } else {
        tryMove(p, -d[0] * 256, -d[1] * 256, PBOX, true);
      }
      const tip = BAZOOKA_TIP[p.facing][p.row % 2 ? 1 : 0];
      bullets.push({ x: ((p.x >> 8) + tip[0]) * 256 + 128, y: ((p.y >> 8) + tip[1]) * 256 + 128, vx, vy, life: bulletRange() << 8, direct: gun, img: gun ? "shotSmallImage" : "shotBigImage" }); // Kurt (gun) / Kathy (cohete)
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
      if (itemsLayer[idx] === 26) {
        setItemTile(idx, -1);
        p.hp = Math.min(maxHp(p), p.hp + 1);
        sfx("heart");
      } else if (itemsLayer[idx] === 25 && !coinWaiting(idx)) {
        setItemTile(idx, -1);
        p.coins++;
        sfx("coin");
      }
    }
  }

  if (p.inv > 0) p.inv--;
}

// Habilidad especial: mantener SELECT apunta un area delante; al soltar queda activa (Kathy: dano continuo; Kurt: golpe x3 instantaneo).
// Skreek lanza un proyectil que lo atraviesa todo al pulsar SELECT con la barra llena.
function specialRect(sp) {
  return { x: sp.tx * 8, y: sp.ty * 8, w: sp.w * 8, h: sp.h * 8 };
}

function specialHit(p, sp, mult, hurtPlayers) {
  const r = specialRect(sp);
  for (const e of enemies) {
    if (e.hp > 0 && overlap(e.x >> 8, e.y >> 8, e.box, 0, 0, r)) damageEnemy(e, specialDamage() * mult);
  }
  for (let k = 0; k < sp.w * sp.h; k++) {
    checkBulletHitItems((sp.tx + (k % sp.w)) * 8 + 4, (sp.ty + ((k / sp.w) | 0)) * 8 + 4);
  }
  if (!hurtPlayers) return;
  for (const q of players) {
    if (q.active && q.hp > 0 && !q.tp && overlap(q.x >> 8, q.y >> 8, PBOX, 0, 0, r)) {
      q.hp -= specialDamage();
      q.hit = CFG.hurtFlash;
    }
  }
}

function updateSpecial(p, held) {
  const sel = (held & BTN.SELECT) !== 0;
  const ult = p.ch.ult;
  if (ult === "beam") {
    if (p.mana < CFG.specialCharge) p.mana = Math.min(CFG.specialCharge, p.mana + manaRegen());
    else if (input.pressed[p.id] & BTN.SELECT) {
      const u = DIRU[p.facing];
      const s = CFG.bulletSpeed;
      bullets.push({ x: ((p.x >> 8) + 8) * 256, y: ((p.y >> 8) + 12) * 256, vx: (u[0] * s) >> 8, vy: (u[1] * s) >> 8, life: 480 << 8, beam: true });
      p.mana = 0;
      sfx("special");
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
      [w, h] = d[0] ? [long, 2] : [2, long];
    }
    const dist = (d[0] ? w : h) * 4 + 8;
    const cx = (p.x >> 8) + 8 + ((u[0] * dist + 128) >> 8);
    const cy = (p.y >> 8) + 9 + ((u[1] * dist + 128) >> 8);
    p.sp = { state: "aim", w, h, tx: (cx >> 3) - (w >> 1), ty: (cy >> 3) - (h >> 1), t: 0 };
  } else if (p.sp) {
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

// Continuar: mismo mapa, oleada, monedas y cristales; los jugadores reviven con la vida completa.
function continueGame() {
  players.forEach((p, i) => {
    if (!p.active) return;
    p.hp = maxHp(p);
    [p.x, p.y] = startPos(i).map((v) => v << 8);
    p.inv = invulnFrames();
    p.hit = 0;
    p.tp = null;
    p.ammo = ammoMax(p);
    p.reloadT = 0;
    p.sp = null;
  });
  enemies = [];
  bullets = [];
  wave = Math.max(0, wave - 1);
  waveTimer = 60;
  gameOver = false;
  goSel = 0;
}

