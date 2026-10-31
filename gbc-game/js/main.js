"use strict";
/* Bucle principal: update(), inicializacion y game loop. */

function update() {
  if (screen !== "game") { updateMenu(); return; }
  if (shop) { updateShop(); return; }
  
  // 1. Declaramos primero las variables necesarias
  const live = players.filter(p => p.active && p.hp > 0);
  const end = levelLogic && levelLogic.end;

  // 2. Comprobamos si se llega a la zona END aquí abajo
  if (end && /*!winDelay &&*/ live.length && live.every((p) => {
    const cx = (p.x >> 8) + 8, cy = (p.y >> 8) + 8;
    return cx >= end[0] && cx < end[0] + end[2] && cy >= end[1] && cy < end[1] + end[3];
  })) { 
   // winDelay = 90; 
    sfx("open"); 
    openShop("win"); 
  }

  if (!gameOver) stats.time++;
  // ... resto del código de update ...
  if (gameOver) {
    const pr = input.pressed[0] | input.pressed[1];
    if (pr & (BTN.UP | BTN.DOWN)) goSel ^= 1;
    if (pr & (BTN.START | BTN.A)) {
      if (goSel === 0) continueGame();
      else { resetGame(); openSelect(); }
    }
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
  updateCoins();
  for (const p of players) updatePlayer(p);


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

  // Proyectiles
  for (const b of bullets) {
    b.x += b.vx; b.y += b.vy;
    b.life -= Math.max(Math.abs(b.vx), Math.abs(b.vy));
    const bx = b.x >> 8, by = b.y >> 8;

    if (b.life <= 0) {
      b.dead = true;
      continue;
    }

    if (b.beam) {
      for (const e of enemies) {
        if (e.hp > 0 && overlap(bx - 4, by - 4, { x: 0, y: 0, w: 8, h: 8 }, e.x >> 8, e.y >> 8, e.box)) damageEnemy(e, 99);
      }
      for (let k = 0; k < 3; k++) checkBulletHitItems(bx, by);
      if (boxBlocked(bx, by, BBOX, true, false)) b.dead = true;
      continue;
    }

    // --- Enemigos: area de impacto generosa (la bala cuenta como una caja de (2*pad+1) px, no un punto).
    // Va ANTES que las paredes: si toca a un enemigo en el mismo frame que un muro, el enemigo recibe el golpe.
    // Tambien se comprueba mientras la bala sigue "chocada" (linger), para no perder impactos visibles.
    const pad = CFG.bulletHitPad;
    const hitBox = { x: -pad, y: -pad, w: 2 * pad + 1, h: 2 * pad + 1 };
    if (b.direct) {
      const hit = enemies.find((e) => e.hp > 0 && overlap(bx, by, hitBox, e.x >> 8, e.y >> 8, e.box));
      if (hit) {
        damageEnemy(hit, 1 + (lv("dmg") >> 1));
        b.dead = true;
        continue;
      }
    } else {
      for (const e of enemies) {
        if (e.hp <= 0) continue;
        const dx = (e.x >> 8) + 4 - bx;
        const dy = (e.y >> 8) + 4 - by;
        if (dx * dx + dy * dy <= CFG.fuseRadius * CFG.fuseRadius ||
            overlap(bx, by, hitBox, e.x >> 8, e.y >> 8, e.box)) {
          explode(bx, by);
          sfx("explosion");
          b.dead = true;
          break;
        }
      }
      if (b.dead) continue;
    }

    // Bala ya chocada: sigue avanzando unos frames (queda "encima" de lo que golpeo) y desaparece.
    if (b.linger !== undefined) {
      if (--b.linger <= 0) b.dead = true;
      continue;
    }

    // --- Paredes e items. El disparo vuela a ~1 tile del suelo: la colision con muros se calcula en el suelo
    // (gy) para poder pasar por delante de cosas altas, pero con margen en los bordes (ver bulletBlocked).
    // Lo destruible (barreras, cajas) se golpea tambien en la posicion VISUAL (by) y con margen lateral:
    // si la bala se ve encima, hace dano.
    const gy = by + CFG.bulletGroundOffset;
    if (bulletHitsItems(bx, by, gy, pad) || bulletBlocked(b, bx, gy)) {
      b.linger = CFG.bulletLinger; // en vez de morir al instante, se queda un poco mas
    }
  }
  bullets = bullets.filter(b => !b.dead);
  enemies = enemies.filter(e => e.hp > 0);

  updateEnemies();
  for (const e of enemies) {
    if (e.hit > 0) e.hit--;
    for (const p of live) {
      if (!p.tp && p.inv === 0 && overlap(p.x >> 8, p.y >> 8, PBOX, e.x >> 8, e.y >> 8, e.box)) {
        p.hp--;
        sfx("hurt");
        p.inv = invulnFrames();
        p.hit = CFG.hurtFlash;
      }
    }
  }

  if (enemies.length === 0 && --waveTimer <= 0) spawnWave();
  if (!players.some(p => p.active && p.hp > 0)) {
openShop("death"); // Viene de morir
}

}

// Version "golpeada" de una imagen: la rampa de verdes se invierte (oscuro <-> claro), como una paleta alternativa.

// ------------------------------------------------------------ Inicializacion
async function start() {
  assets = await DMGLoader.init();
  initText();
  initComposites();
  hitImages.tileset = makeHitImage(assets.tilesetImage);
  hitImages.playerImage = makeHitImage(assets.playerImage);
  hitImages.kurtImage = makeHitImage(assets.kurtImage, true);
  hitImages.skreekImage = makeHitImage(assets.skreekImage, true);
  hitImages.enemyImage = makeHitImage(assets.enemyImage);
  hitImages.bigSlugImage = makeHitImage(assets.bigSlugImage);
  hitImages.beeImage = makeHitImage(assets.beeImage, true);
  MAP_W = assets.itemsMap.w;
  MAP_H = assets.itemsMap.h;
  itemsLayer = assets.itemsMap.data.slice();
  itemsAttrs = assets.itemsMap.attrs.slice();
  initialItemsLayer = itemsLayer.slice();
  initialItemsAttrs = itemsAttrs.slice();
  fondoLayer = assets.backgroundMap.data.slice();
  fondoAttrs = assets.backgroundMap.attrs.slice();
  // En lugar de baseLevel = ... y level1Level = ..., ponemos:
  if (assets.levels && assets.levels.length) {
    allLevels = assets.levels;
  } else {
    // Respaldo por si aún solo carga level1:
    allLevels = [
      {
        w: assets.level1Fondo.w,
        h: assets.level1Fondo.h,
        fondo: assets.level1Fondo.data.slice(),
        fondoAttrs: assets.level1Fondo.attrs.slice(),
        items: assets.level1Items.data.slice(),
        itemsAttrs: assets.level1Items.attrs.slice(),
        logic: assets.level1Logic
      }
    ];
  }
  gbc.ctx.imageSmoothingEnabled = false;

  for (let i = 0; i < MAP_W * MAP_H; i++) syncMapCell(i);

  resetGame(); window.__t = { players: () => players, enemies: () => enemies, level: () => level, logic: () => levelLogic }; // TEMP = () => { paused = !paused; };

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
