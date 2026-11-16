"use strict";
/* Bucle principal: update(), inicializacion y game loop. */

window.pauseSel = 0;

function update() {
  if (screen !== "game") { updateMenu(); return; }
  if (shop) { updateShop(); return; }

  const prAll = input.pressed[0] | input.pressed[1];
  if (!gameOver && (prAll & BTN.START)) {
    paused = !paused;
    window.pauseSel = 0;
    return;
  }
  if (paused) {
    if (prAll & BTN.UP) window.pauseSel = (window.pauseSel + 2) % 3;
    if (prAll & BTN.DOWN) window.pauseSel = (window.pauseSel + 1) % 3;
    if (prAll & (BTN.A | BTN.START)) {
      if (window.pauseSel === 0) {
        paused = false; // Continuar
      } else if (window.pauseSel === 1) {
        paused = false;
        resetGame(); // Reiniciar
        players[1].active = multiplayer;
      } else if (window.pauseSel === 2) {
        paused = false;
        resetGame();
        openSelect(); // Salir al menú
      }
    }
    return;
  }
  
  const live = players.filter(p => p.active && p.hp > 0);
  const end = levelLogic && levelLogic.end;

  // Llegada a la zona END: todos los jugadores vivos dentro.
  if (end && live.length && live.every((p) => {
    const cx = (p.x >> 8) + 8, cy = (p.y >> 8) + 8;
    return cx >= end[0] && cx < end[0] + end[2] && cy >= end[1] && cy < end[1] + end[3];
  })) {
    sfx("open");
    openShop("win");
  }

  if (!gameOver) stats.time++;
  if (gameOver) {
    const pr = input.pressed[0] | input.pressed[1];
    if (pr & (BTN.UP | BTN.DOWN)) goSel ^= 1;
    if (pr & (BTN.START | BTN.A)) {
      if (goSel === 0) continueGame();
      else { resetGame(); openSelect(); }
    }
    return;
  }

  if (multiplayer && !players[1].active && input.held[1]) {
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
  enemyDeathEffects = enemyDeathEffects.filter((effect) => {
    effect.age++;
    return effect.age < CFG.enemyDeathFrames;
  });
  updateSpecialExplosions();
  for (const [idx, timer] of blasts) {
    if (timer <= 1) blasts.delete(idx);
    else blasts.set(idx, timer - 1);
  }

  for (const p of players) if (p.active && p.hp > 0 && p.shield > 0) p.shield--;
  updateInteractives();
  updateCoins();
  for (const p of players) updatePlayer(p);

  updateCamera(live);

  updateBullets();

  updateEnemies();
  for (const e of enemies) {
    if (e.hit > 0) e.hit--;
    for (const p of live) {
      if (!p.tp && p.inv === 0 && p.shield === 0 && overlap(p.x >> 8, p.y >> 8, PBOX, e.x >> 8, e.y >> 8, e.box)) {
        p.hp--;
        sfx("hurt");
        p.inv = invulnFrames();
        p.hit = CFG.hurtFlash;
      }
    }
  }

  updateSpawnPoints();
  if (!players.some((p) => p.active && p.hp > 0)) openShop("death");
}

function updateCamera(live) {
  if (wallShake > 0) return;
  if (live.length) {
    let mx = 0, my = 0;
    for (const p of live) { mx += (p.x >> 8) + 8; my += (p.y >> 8) + 12; }
    if (live.length > 1) { mx >>= 1; my >>= 1; }
    const tx = Math.max(0, Math.min(MAP_W * 8 - 160, mx - 80));
    const ty = Math.max(0, Math.min(MAP_H * 8 - VIEW_H, my - (VIEW_H >> 1)));
    const dxc = tx - cam.x, dyc = ty - cam.y;
    cam.x += dxc < 0 ? -((-dxc) >> 2) : dxc >> 2;
    cam.y += dyc < 0 ? -((-dyc) >> 2) : dyc >> 2;
  }
}

// Proyectiles: movimiento, impacto en enemigos, paredes y objetos.
function updateBullets() {
  for (const b of bullets) {
    if (b.linger !== undefined) {
      if (--b.linger <= 0) b.dead = true;
      continue;
    }
    b.life -= Math.max(Math.abs(b.vx), Math.abs(b.vy));
    if (b.life <= 0) {
      b.dead = true;
      continue;
    }

    const startX = b.x, startY = b.y;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(b.vx), Math.abs(b.vy)) / 256));
    const beamHits = b.beam ? new Set() : null;
    for (let step = 0; step <= steps; step++) {
      b.x = startX + Math.trunc(b.vx * step / steps);
      b.y = startY + Math.trunc(b.vy * step / steps);
      const bx = b.x >> 8, by = b.y >> 8;
      const gy = by + (b.beam ? 0 : CFG.bulletGroundOffset);
      if (bulletBlocked(b, bx, gy)) {
        const hits = b.beam ? 3 : 1;
        for (let k = 0; k < hits; k++) checkBulletHitItems(bx, gy);
        b.linger = CFG.bulletLinger;
        break;
      }
      hitBulletBarrier(b, bx, gy);
      if (step === 0) continue;

      const pad = b.beam ? 4 : CFG.bulletHitPad;
      const hitBox = { x: -pad, y: -pad, w: 2 * pad + (b.beam ? 0 : 1), h: 2 * pad + (b.beam ? 0 : 1) };
      for (const e of enemies) {
        if (e.hp <= 0 || !attackReachesBox(bx, gy, e.x >> 8, e.y >> 8, e.box, b.beam ? 0 : CFG.bulletGroundOffset)) continue;
        const overlapHit = overlap(bx, by, hitBox, e.x >> 8, e.y >> 8, e.box);
        if (b.beam) {
          if (overlapHit && !beamHits.has(e)) {
            beamHits.add(e);
            damageEnemy(e, 99);
          }
        } else if (b.direct && overlapHit) {
          damageEnemy(e, 1 + (lv("dmg") >> 1));
          b.dead = true;
          break;
        } else if (!b.direct) {
          const dx = (e.x >> 8) + 4 - bx, dy = (e.y >> 8) + 4 - by;
          if (dx * dx + dy * dy <= CFG.fuseRadius * CFG.fuseRadius || overlapHit) {
            explode(bx, by);
            sfx("explosion");
            b.dead = true;
            break;
          }
        }
      }
      if (b.dead) break;
    }
  }
  bullets = bullets.filter(b => !b.dead);
  enemies = enemies.filter(e => e.hp > 0);
}

// ------------------------------------------------------------ Inicializacion
// Hojas de sprites con version "golpeada" (flash al recibir dano). true = aclarar en vez de invertir la rampa de verdes.
// Al anadir un personaje nuevo, anade aqui su imagen (la clave es la de assets).
const HIT_SPRITES = {
  playerImage: false, kurtImage: true, skreekImage: true,
};
const ENEMY_HIT_SPRITES = ["enemyImage", "bigSlugImage", "beeImage"];

async function start() {
  assets = await DMGLoader.init();
  allLevels = assets.levels;
  initPickupTiles();
  initHud();
  hitImages.pickups = makeHitImage(assets.pickupTileset);
  initText();
  initAboutQr();
  initComposites();
  initEnemyFrameBottoms();
  for (const [key, brighten] of Object.entries(HIT_SPRITES)) hitImages[key] = makeHitImage(assets[key], brighten);
  Object.assign(hitImages, makeEnemyHitImages(Object.fromEntries(ENEMY_HIT_SPRITES.map((key) => [key, assets[key]]))));
  gbc.ctx.imageSmoothingEnabled = false;
  resetGame(); // carga el primer nivel (useLayout) y deja todo listo

  const STEP = 1000 / 59.73;
  let last = performance.now(), acc = 0;

  function loop(now) {
    acc += Math.min(now - last, 100);
    last = now;
    while (acc >= STEP) {
      acc -= STEP;
      input.poll();
      update();
      if (!paused) frame++;
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
