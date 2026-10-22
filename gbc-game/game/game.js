/*
 * Prototipo: accion top-down multijugador local (2 jugadores) con limites de GBC.
 * Todo el dibujo pasa por el motor GBC (engine/gbc.js): tiles, mapas, OAM, paletas.
 *
 * Controles
 *   J1: WASD mover, F disparar (A), G (B, sin usar aun)
 *   J2: flechas mover, "," disparar (A), "." (B). El J2 entra al pulsar cualquier boton.
 *   Gamepad 1 -> J1, gamepad 2 -> J2
 *   Enter = reiniciar tras GAME OVER   P = pausa
 *   Depuracion: 1 hitboxes+colision   2 filtro de color LCD   3 efecto por scanline
 *               4 meter 8 enemigos encima del J1 (prueba del limite de 10 sprites/linea)
 */
(function () {
  "use strict";
  const A = window.ASSETS;
  const canvas = document.getElementById("screen");
  const gbc = new GBC(canvas);
  const input = new Input();

  // ------------------------------------------------------------ parametros
  const CFG = {
    playerSpeed: 1.25,       // px/frame del personaje
    enemySpeed: 0.1,         // px/frame de los enemigos
    chaseRange: 5,           // tiles: los enemigos solo persiguen si hay un jugador a menos de esto
    blastRadius: 2,          // tiles: radio de la explosion de la bala de Kathy
    fuseRadius: 8,           // px: la bala explota si pasa a menos de esto del centro de un enemigo
    blastFrames: 10,         // frames que dura el flash de paleta de la explosion
    wanderFactor: 0.5,       // velocidad al vagar (sin perseguir) como fraccion de la de persecucion
    speedJitter: 0.10,       // +-10% de velocidad aleatoria por enemigo (se sortea al nacer)
    tpDistance: 2,           // tiles que se desplaza Kathy al teletransportarse (boton B)
    tpAhead: 8,              // px: el portal de entrada aparece este tramo por delante de Kathy
    tpStepFrames: 4,         // frames de juego por "frame" de animacion del teleport
    portalHold: 5,           // frames de animacion que aguantan los portales tras abrirse el de salida
    tpCooldown: 40,          // frames hasta poder volver a teletransportarse
    hurtFlash: 6,            // frames con paleta roja al recibir dano
    bulletSpeed: 3 * 256,    // px/frame (8.8)
    bulletRange: 112,        // px de alcance
    fireRate: 2,             // disparos por segundo
    waveBase: 3,             // enemigos en la oleada 0
    wavePerWave: 1,          // enemigos extra por cada oleada
    waveMax: 12,             // tope de enemigos por oleada
    playerHp: 3,
    enemyHp: 2,
    invuln: 90,              // frames de invulnerabilidad tras un golpe
    runAnimFrames: 6,        // frames de juego por frame de animacion al correr
    enemyAnimFrames: 14,
    wavePause: 90,
  };
  const DIAG = 181; // 256 * 0.7071

  // Cajas de colision relativas a la esquina superior izquierda del sprite
  const PBOX = { x: 4, y: 10, w: 8, h: 6 };   // pies de Kathy (sprite 16x16)
  const EBOX = { x: 1, y: 1, w: 6, h: 6 };    // enemigo (sprite 8x8)
  const BBOX = { x: 2, y: 2, w: 4, h: 4 };    // proyectil (sprite 8x8)

  // Orden de columnas del spritesheet: abajo-izq y en sentido horario
  const DIRS = [[-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1]];
  const DIR_INDEX = [];
  DIRS.forEach((d, i) => { DIR_INDEX[(d[1] + 1) * 3 + (d[0] + 1)] = i; });

  const MAP_W = A.map.w, MAP_H = A.map.h;
  const VIEW_H = 136; // alto visible; los ultimos 8 pixeles son la Window (HUD)

  // ------------------------------------------------------- VRAM y paletas
  gbc.loadTiles(0, 0, A.bgTiles);       // banco 0: tiles de fondo (+ moneda + fuente)
  gbc.loadTiles(1, 0, A.objTiles);      // banco 1: tiles de sprites
  A.bgPalettes.forEach((p, i) => gbc.setBgPalette(i, p));
  A.objPalettes.forEach((p, i) => gbc.setObjPalette(i, p));
  for (let i = 0; i < MAP_W * MAP_H; i++) {
    gbc.mapTile[0][i] = A.map.tiles[i];
    gbc.mapAttr[0][i] = A.map.attrs[i];
  }

  // Fuente del HUD (3x5 y 5x5), generada como tiles de 2bpp en el banco 0
  const GLYPHS = {
    " ": ["000", "000", "000", "000", "000"],
    "0": ["111", "101", "101", "101", "111"], "1": ["010", "110", "010", "010", "111"],
    "2": ["111", "001", "111", "100", "111"], "3": ["111", "001", "111", "001", "111"],
    "4": ["101", "101", "111", "001", "001"], "5": ["111", "100", "111", "001", "111"],
    "6": ["111", "100", "111", "101", "111"], "7": ["111", "001", "010", "010", "010"],
    "8": ["111", "101", "111", "101", "111"], "9": ["111", "101", "111", "001", "111"],
    W: ["101", "101", "101", "111", "101"], G: ["111", "100", "101", "101", "111"],
    A: ["111", "101", "111", "101", "101"], M: ["101", "111", "111", "101", "101"],
    E: ["111", "100", "111", "100", "111"], O: ["111", "101", "101", "101", "111"],
    V: ["101", "101", "101", "101", "010"], R: ["111", "101", "110", "101", "101"],
    h: ["01010", "11111", "11111", "01110", "00100"],   // corazon
    c: ["01110", "10001", "10101", "10001", "01110"],   // icono de moneda
  };
  const glyphId = {};
  (function () {
    let id = A.bgTiles.length;
    for (const ch of Object.keys(GLYPHS)) {
      const rows = GLYPHS[ch], w = rows[0].length, ox = (8 - w) >> 1, oy = 1;
      const bytes = new Array(16).fill(0);
      rows.forEach((r, y) => {
        let b = 0;
        for (let x = 0; x < 8; x++) b = (b << 1) | ((x >= ox && x < ox + w && r[x - ox] === "1") ? 1 : 0);
        bytes[(y + oy) * 2] = b; bytes[(y + oy) * 2 + 1] = b; // color 3
      });
      gbc.vram[0].set(bytes, id * 16);
      glyphId[ch] = id++;
    }
  })();

  // Paletas "dolor": version rojiza de cada paleta de sprite (OBJ 4 = J1, 5 = J2, 6 = enemigo)
  function redden(pal) {
    return pal.map((c, i) => {
      if (i === 0) return 0;
      const r = c & 31, g = (c >> 5) & 31, b = (c >> 10) & 31;
      const R = Math.min(31, r + ((31 - r) * 0.55 | 0) + 4), G = (g * 0.35) | 0, B = (b * 0.3) | 0;
      return R | (G << 5) | (B << 10);
    });
  }
  const PAL_HURT_P1 = 4, PAL_HURT_P2 = 5, PAL_HURT_EN = 6;
  gbc.setObjPalette(PAL_HURT_P1, redden(A.objPalettes[0]));
  gbc.setObjPalette(PAL_HURT_P2, redden(A.objPalettes[1]));
  gbc.setObjPalette(PAL_HURT_EN, redden(A.objPalettes[2]));

  // Paleta de fondo 7: HUD en la ultima fila de pantalla (lineas 136+) y, en las
  // lineas 0-135 (donde el HUD no se ve), paleta de EXPLOSION. Se cambia por scanline
  // en onScanline, como se haria en una GBC real con una interrupcion STAT en LY=136.
  const rgb = (r, g, b) => r | (g << 5) | (b << 10);
  const HUD_PAL = A.bgPalettes[A.hudPalette].slice();
  const BLAST_PALS = [
    [rgb(31, 25, 10), rgb(31, 27, 13), rgb(31, 29, 17), rgb(31, 31, 23)],   // inicio: amarillo-blanco
    [rgb(27, 13, 4), rgb(28, 15, 5), rgb(29, 17, 6), rgb(31, 21, 8)],       // final: naranja
  ];

  // Window = barra de HUD en la ultima fila de pantalla
  gbc.lcdc.winOn = true;
  gbc.wx = 7;
  gbc.wy = 136;
  gbc.mapAttr[1].fill(A.hudPalette);
  function drawHud(str) {
    for (let i = 0; i < 32; i++) {
      gbc.mapTile[1][i] = glyphId[str[i] || " "] !== undefined ? glyphId[str[i] || " "] : glyphId[" "];
    }
  }

  // ---------------------------------------------------------------- estado
  const cam = { x: 0, y: 0 };
  let frame = 0, wave = 0, waveTimer = 0, gameOver = false;
  let players = [], enemies = [], bullets = [];
  const coins = new Map();  // celda -> {tile, attr} originales del fondo
  let debug = false, wobble = false, paused = false;

  const solid = A.solid;
  function cellSolid(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return true;
    return solid[ty * MAP_W + tx] === 1;
  }
  function boxBlocked(x, y, b, limitToCam) {
    const l = x + b.x, t = y + b.y, r = l + b.w - 1, bt = t + b.h - 1;
    if (limitToCam && (l < cam.x || r >= cam.x + 160 || t < cam.y || bt >= cam.y + VIEW_H)) return true;
    for (let ty = t >> 3; ty <= bt >> 3; ty++)
      for (let tx = l >> 3; tx <= r >> 3; tx++)
        if (cellSolid(tx, ty)) return true;
    return false;
  }
  // mueve por ejes separados para deslizar por las paredes; devuelve si se movio
  function tryMove(e, dx, dy, box, limitToCam, extra) {
    let moved = false;
    const nx = e.x + dx;
    if (dx && !boxBlocked(nx >> 8, e.y >> 8, box, limitToCam) && !(extra && extra(nx >> 8, e.y >> 8))) { e.x = nx; moved = true; }
    const ny = e.y + dy;
    if (dy && !boxBlocked(e.x >> 8, ny >> 8, box, limitToCam) && !(extra && extra(e.x >> 8, ny >> 8))) { e.y = ny; moved = true; }
    return moved;
  }
  // Colision enemigo-enemigo: bloquea si el nuevo hueco pisa a otro enemigo con el que
  // no se estaba pisando ya (asi los que nacen solapados pueden separarse).
  function enemyBlocks(e, nx, ny) {
    const ox = e.x >> 8, oy = e.y >> 8;
    for (const o of enemies) {
      if (o === e || o.hp <= 0) continue;
      const px = o.x >> 8, py = o.y >> 8;
      if (overlap(nx, ny, EBOX, px, py, EBOX) && !overlap(ox, oy, EBOX, px, py, EBOX)) return true;
    }
    return false;
  }
  function overlap(ax, ay, a, bx, by, b) {
    return ax + a.x < bx + b.x + b.w && ax + a.x + a.w > bx + b.x &&
           ay + a.y < by + b.y + b.h && ay + a.y + a.h > by + b.y;
  }
  function findFree(px, py, box, extra) {
    const ok = (x, y) => !boxBlocked(x, y, box) && !(extra && extra(x, y));
    if (ok(px, py)) return [px, py];
    for (let r = 4; r <= 96; r += 4)
      for (let oy = -r; oy <= r; oy += 4)
        for (let ox = -r; ox <= r; ox += 4)
          if (Math.max(Math.abs(ox), Math.abs(oy)) === r && ok(px + ox, py + oy)) return [px + ox, py + oy];
    return [px, py];
  }

  // -------------------------------------------------------------- reinicio
  function newPlayer(i, x, y) {
    const [fx, fy] = findFree(x, y, PBOX);
    return { id: i, x: fx << 8, y: fy << 8, facing: 7, hp: CFG.playerHp, coins: 0, cd: 0,
             inv: 0, animT: 0, row: 0, active: i === 0, tp: null, tpCd: 0 };
  }
  function resetGame() {
    for (const [cell, o] of coins) { gbc.mapTile[0][cell] = o.tile; gbc.mapAttr[0][cell] = o.attr; }
    coins.clear();
    players = [newPlayer(0, 104, 150), newPlayer(1, 136, 150)];
    enemies = []; bullets = []; portals.length = 0;
    wave = 0; waveTimer = 60; gameOver = false;
    cam.x = 48; cam.y = 80;
  }

  // ------------------------------------------------------------- enemigos
  const SPAWNS = [[10, 10], [20, 10], [12, 25], [22, 26], [8, 18], [18, 18], [26, 10], [6, 26]];
  function spawnEnemyAt(px, py) {
    const [fx, fy] = findFree(px, py, EBOX, (x, y) => enemies.some((o) => overlap(x, y, EBOX, o.x >> 8, o.y >> 8, EBOX)));
    enemies.push({ x: fx << 8, y: fy << 8, hp: CFG.enemyHp, dir: 7, animT: 0, moving: false,
                   spd: 1 + (Math.random() * 2 - 1) * CFG.speedJitter, wT: 0, wDir: -1 });
  }
  function spawnWave() {
    wave++;
    const n = Math.min(CFG.waveBase + (wave - 1) * CFG.wavePerWave, CFG.waveMax);
    const alive = players.filter((p) => p.active && p.hp > 0);
    let k = 0;
    for (let i = 0; i < SPAWNS.length * 6 && k < n; i++) {
      const s = SPAWNS[i % SPAWNS.length];
      const px = s[0] * 8, py = s[1] * 8;
      if (alive.some((p) => Math.abs((p.x >> 8) - px) < 56 && Math.abs((p.y >> 8) - py) < 56)) continue;
      spawnEnemyAt(px, py); k++;
    }
    if (k === 0) spawnEnemyAt(SPAWNS[0][0] * 8, SPAWNS[0][1] * 8);
  }

  function dropCoin(ex, ey) {
    const cx = (ex + 4) >> 3, cy = (ey + 4) >> 3, cell = cy * MAP_W + cx;
    if (cellSolid(cx, cy) || coins.has(cell)) return;
    coins.set(cell, { tile: gbc.mapTile[0][cell], attr: gbc.mapAttr[0][cell] });
    gbc.mapTile[0][cell] = A.coinTile;   // escritura al mapa de fondo (como en VBlank)
    gbc.mapAttr[0][cell] = A.coinPalette;
  }

  // ------------------------------------------------------------ actualizar
  function updatePlayer(p) {
    if (!p.active || p.hp <= 0) return;
    const held = input.held[p.id];
    const dx = ((held & BTN.RIGHT) ? 1 : 0) - ((held & BTN.LEFT) ? 1 : 0);
    const dy = ((held & BTN.DOWN) ? 1 : 0) - ((held & BTN.UP) ? 1 : 0);
    const moving = dx !== 0 || dy !== 0;
    const firing = (held & BTN.A) !== 0;

    if (p.hit > 0) p.hit--;
    if (p.tpCd > 0) p.tpCd--;
    if (p.tp) { updateTeleport(p); return; }
    if ((input.pressed[p.id] & BTN.B) && p.tpCd === 0) { startTeleport(p, moving ? DIR_INDEX[(dy + 1) * 3 + (dx + 1)] : p.facing); return; }

    // Apuntado: con A pulsado la direccion se queda fija; sin A mira hacia donde se mueve
    if (!firing && moving) p.facing = DIR_INDEX[(dy + 1) * 3 + (dx + 1)];

    if (moving) {
      let sp = Math.round(CFG.playerSpeed * 256);
      if (dx && dy) sp = (sp * DIAG) >> 8;
      tryMove(p, dx * sp, dy * sp, PBOX, true);
      p.animT++;
      p.row = 1 + (((p.animT / CFG.runAnimFrames) | 0) % 4);
    } else {
      p.animT = 0; p.row = 0;
    }

    if (p.cd > 0) p.cd--;
    if (firing && p.cd === 0) {
      const d = DIRS[p.facing];
      let vx = d[0] * CFG.bulletSpeed, vy = d[1] * CFG.bulletSpeed;
      if (d[0] && d[1]) { vx = (vx * DIAG) >> 8; vy = (vy * DIAG) >> 8; }
      // sale del pixel amarillo de la punta del bazoka (tabla A.muzzle[fila][angulo])
      const m = A.muzzle[p.row][p.facing];
      const cx = ((p.x >> 8) + m[0]) * 256 + 128, cy = ((p.y >> 8) + m[1]) * 256 + 128;
      bullets.push({ x: cx - A.bulletCenter[0] * 256, y: cy - A.bulletCenter[1] * 256, vx, vy, life: CFG.bulletRange << 8 });
      p.cd = Math.max(1, Math.round(59.7275 / CFG.fireRate));
    }
    if (p.inv > 0) p.inv--;
  }

  // Vagar: elige una direccion al azar (o se para un rato) y camina a la mitad de velocidad
  function wander(e, spd) {
    if (!(e.wT > 0)) {
      if (Math.random() < 0.25) { e.wDir = -1; e.wT = 30 + (Math.random() * 60 | 0); }
      else { e.wDir = (Math.random() * 8) | 0; e.wT = 40 + (Math.random() * 80 | 0); }
    }
    e.wT--;
    e.moving = false;
    if (e.wDir < 0) return;
    const d = DIRS[e.wDir];
    e.dir = e.wDir;
    let sp = Math.round(CFG.enemySpeed * CFG.wanderFactor * spd * 256);
    if (d[0] && d[1]) sp = (sp * DIAG) >> 8;
    e.moving = tryMove(e, d[0] * sp, d[1] * sp, EBOX, false, (nx, ny) => enemyBlocks(e, nx, ny));
    if (e.moving) e.animT++; else e.wT = 0;   // choco con algo: elige otra direccion
  }

  // ---------------------------------------------------------------- teleport (boton B)
  // Pasos de animacion (cada uno dura CFG.tpStepFrames frames de juego):
  //   0: aparece el portal de entrada justo delante de Kathy
  //   1: el portal de entrada sigue, aparece el de salida; Kathy esta entrando (solo se ve su mitad trasera)
  //   2: Kathy ya esta en destino y sale del portal de salida (solo se ve su mitad delantera)
  //   3: Kathy completa, recupera el control. Los portales aguantan CFG.portalHold pasos mas y se cierran.
  const portals = [];
  function dirIndexOf(d) { return DIR_INDEX[(d[1] + 1) * 3 + (d[0] + 1)]; }
  function startTeleport(p, facing) {
    const d = DIRS[facing], len = Math.hypot(d[0], d[1]), ux = d[0] / len, uy = d[1] / len;
    const cx = (p.x >> 8) + 8, cy = (p.y >> 8) + 9;
    const D = CFG.tpDistance * 8;
    // destino: el punto mas cercano a D (primero hacia delante, atravesando muros, luego hacia atras) donde cabe Kathy
    let best = null;
    const cands = [];
    for (let r = D; r <= D + 24; r += 2) cands.push(r);
    for (let r = D - 2; r >= 4; r -= 2) cands.push(r);
    for (const r of cands) {
      const nx = Math.round(cx + ux * r) - 8, ny = Math.round(cy + uy * r) - 9;
      if (!boxBlocked(nx, ny, PBOX, true)) { best = [nx, ny]; break; }
    }
    if (!best) return;   // no hay sitio donde reaparecer
    const ahead = CFG.tpAhead;
    p.facing = facing;
    p.tp = { step: 0, t: 0, d: facing, dest: best,
             c0: [cx, cy], c1: [best[0] + 8, best[1] + 9],
             p1: [Math.round(cx + ux * ahead), Math.round(cy + uy * ahead)] };
    addPortal(p.tp.p1, facing, 0, CFG.portalHold + 1, true);
    p.row = 0; p.animT = 0;
  }
  function addPortal(c, dir, delay, life, entry) {
    portals.push({ c, dir, age: -delay * CFG.tpStepFrames, life: life * CFG.tpStepFrames, entry });
  }
  function updateTeleport(p) {
    const tp = p.tp;
    if (++tp.t < CFG.tpStepFrames) return;
    tp.t = 0; tp.step++;
    if (tp.step === 1) addPortal(tp.c1, tp.d, 0, CFG.portalHold, false);
    if (tp.step === 2) { p.x = tp.dest[0] << 8; p.y = tp.dest[1] << 8; }
    if (tp.step >= 3) { p.tp = null; p.tpCd = CFG.tpCooldown; }
  }
  // partes (0=arriba-izq, 1=arriba-der, 2=abajo-izq, 3=abajo-der) visibles segun el paso
  function tpParts(p) {
    const d = DIRS[p.tp.d];
    const vis = [];
    for (let k = 0; k < 4; k++) {
      const s = d[0] * ((k & 1) ? 1 : -1) + d[1] * ((k >> 1) ? 1 : -1);   // <0 trasera, >0 delantera
      const step = p.tp.step;
      vis.push(step === 0 ? true : step === 1 ? s <= 0 : step === 2 ? s >= 0 : true);
    }
    return vis;
  }

  function updateEnemy(e) {
    let best = null, bd = 1e9;
    const ex = (e.x >> 8) + 4, ey = (e.y >> 8) + 4;
    for (const p of players) {
      if (!p.active || p.hp <= 0) continue;
      const dx = (p.x >> 8) + 8 - ex, dy = (p.y >> 8) + 9 - ey, d = dx * dx + dy * dy;   // apuntan al torso (a la altura del bazoka)
      if (d < bd) { bd = d; best = [dx, dy]; }
    }
    e.moving = false;
    const rng = CFG.chaseRange * 8;
    const spd = e.spd || 1;
    if (!best || bd > rng * rng) { wander(e, spd); return; }   // fuera de rango: vagan al azar
    if (bd < 9) return;
    const sector = Math.round(Math.atan2(best[1], best[0]) / (Math.PI / 4));
    e.dir = (5 + sector + 16) % 8;
    const d = DIRS[e.dir];
    let sp = Math.round(CFG.enemySpeed * spd * 256);
    if (d[0] && d[1]) sp = (sp * DIAG) >> 8;
    e.moving = tryMove(e, d[0] * sp, d[1] * sp, EBOX, false, (nx, ny) => enemyBlocks(e, nx, ny));
    if (e.moving) e.animT++;
  }

  // Explosion: dano de area (1 por enemigo dentro del radio) + flash de paleta en el suelo
  const blasts = new Map();   // celda -> frames restantes
  let blastAge = 99;          // frames desde la ultima explosion (para animar la paleta)
  function explode(cx, cy) {
    const R = CFG.blastRadius * 8;
    for (const e of enemies) {
      if (e.hp <= 0) continue;
      const dx = (e.x >> 8) + 4 - cx, dy = (e.y >> 8) + 4 - cy;
      if (dx * dx + dy * dy <= R * R) {
        e.hp--; e.hit = CFG.hurtFlash;
        if (e.hp <= 0) dropCoin(e.x >> 8, e.y >> 8);
      }
    }
    // celdas de suelo que toca el circulo
    for (let ty = Math.floor((cy - R) / 8); ty <= Math.floor((cy + R) / 8); ty++)
      for (let tx = Math.floor((cx - R) / 8); tx <= Math.floor((cx + R) / 8); tx++) {
        if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H || solid[ty * MAP_W + tx]) continue;
        const nx = Math.max(tx * 8, Math.min(cx, tx * 8 + 8)), ny = Math.max(ty * 8, Math.min(cy, ty * 8 + 8));
        if ((nx - cx) ** 2 + (ny - cy) ** 2 <= R * R) blasts.set(ty * MAP_W + tx, CFG.blastFrames);
      }
    blastAge = 0;
  }

  function update() {
    if (gameOver) {
      if ((input.pressed[0] | input.pressed[1]) & BTN.START) resetGame();
      return;
    }
    // el J2 entra al pulsar cualquier boton
    if (!players[1].active && input.held[1]) {
      const p1 = players[0], p2 = players[1];
      const [fx, fy] = findFree((p1.x >> 8) + 12, p1.y >> 8, PBOX);
      p2.x = fx << 8; p2.y = fy << 8; p2.active = true;
    }
    for (const p of players) updatePlayer(p);

    // camara: punto medio de los jugadores vivos
    const live = players.filter((p) => p.active && p.hp > 0);
    if (live.length) {
      let mx = 0, my = 0;
      for (const p of live) { mx += (p.x >> 8) + 8; my += (p.y >> 8) + 12; }
      mx /= live.length; my /= live.length;
      const tx = Math.max(0, Math.min(MAP_W * 8 - 160, Math.round(mx - 80)));
      const ty = Math.max(0, Math.min(MAP_H * 8 - VIEW_H, Math.round(my - VIEW_H / 2)));
      cam.x += Math.abs(tx - cam.x) <= 1 ? tx - cam.x : Math.trunc((tx - cam.x) / 4);
      cam.y += Math.abs(ty - cam.y) <= 1 ? ty - cam.y : Math.trunc((ty - cam.y) / 4);
    }

    // proyectiles
    for (const b of bullets) {
      b.x += b.vx; b.y += b.vy;
      b.life -= Math.max(Math.abs(b.vx), Math.abs(b.vy));
      const bx = b.x >> 8, by = b.y >> 8;
      if (b.life <= 0 || boxBlocked(bx, by, BBOX, false)) { b.dead = true; continue; }
      for (const e of enemies) {
        const fx = (e.x >> 8) + 4 - (bx + A.bulletCenter[0]), fy = (e.y >> 8) + 4 - (by + A.bulletCenter[1]);
        if (e.hp > 0 && (overlap(bx, by, BBOX, e.x >> 8, e.y >> 8, EBOX) || fx * fx + fy * fy <= CFG.fuseRadius * CFG.fuseRadius)) {
          b.dead = true;
          explode(bx + A.bulletCenter[0], by + A.bulletCenter[1]);
          break;
        }
      }
    }
    bullets = bullets.filter((b) => !b.dead);
    enemies = enemies.filter((e) => e.hp > 0);

    for (const q of portals) q.age++;
    for (let i = portals.length - 1; i >= 0; i--) if (portals[i].age >= portals[i].life) portals.splice(i, 1);
    for (const [cell, t] of blasts) { if (t <= 1) blasts.delete(cell); else blasts.set(cell, t - 1); }
    blastAge++;
    for (const e of enemies) {
      if (e.hit > 0) e.hit--;
      updateEnemy(e);
      for (const p of live) {
        if (p.inv === 0 && !p.tp && overlap(p.x >> 8, p.y >> 8, PBOX, e.x >> 8, e.y >> 8, EBOX)) {
          p.hp--; p.inv = CFG.invuln; p.hit = CFG.hurtFlash;
        }
      }
    }

    // monedas
    if (coins.size) {
      for (const p of live) {
        const px = p.x >> 8, py = p.y >> 8;
        for (const [cell, o] of coins) {
          const cx = (cell % MAP_W) * 8, cy = ((cell / MAP_W) | 0) * 8;
          if (px + PBOX.x < cx + 8 && px + PBOX.x + PBOX.w > cx && py + PBOX.y < cy + 8 && py + PBOX.y + PBOX.h > cy) {
            gbc.mapTile[0][cell] = o.tile; gbc.mapAttr[0][cell] = o.attr;
            coins.delete(cell); p.coins++;
          }
        }
      }
    }

    // oleadas
    if (enemies.length === 0) {
      if (--waveTimer <= 0) { spawnWave(); waveTimer = CFG.wavePause; }
    }
    if (!players.some((p) => p.active && p.hp > 0)) gameOver = true;
  }

  // ----------------------------------------------------------------- dibujar
  function buildOam() {
    gbc.clearOam();
    let n = 0;
    const put = (x, y, part, pal) => {
      if (!part || n >= 40) return;
      gbc.setSprite(n++, x - cam.x, y - cam.y, part[0], 0x08 | part[1] | pal);
    };
    // Prioridad en GBC: menor indice de OAM = se dibuja encima. Cada portal se emite antes o
    // despues de Kathy segun este delante o detras de ella (en pantalla, lo de mas abajo tapa).
    const drawPortals = (front) => {
      if (!A.portal) return;
      for (const q of portals) {
        if (q.age < 0 || q.front !== front) continue;
        const steps = q.life / CFG.tpStepFrames, a = (q.age / CFG.tpStepFrames) | 0;
        const rows = A.portal.length;
        const row = (a === 0 || a >= steps - 1) ? 0 : rows - 1;     // abre / abierto / cierra
        const parts = A.portal[Math.min(row, rows - 1)][q.dir];
        for (let k = 0; k < 4; k++) put(q.c[0] - 8 + (k & 1) * 8, q.c[1] - 8 + (k >> 1) * 8, parts[k], 7);
      }
    };
    for (const q of portals) {
      const dy = DIRS[q.dir][1];
      // entrada: tapa a Kathy si esta hacia abajo/lateral; salida: al reves (Kathy sale hacia delante)
      q.front = q.entry ? dy >= 0 : dy < 0;
    }
    drawPortals(true);
    for (const p of players) {
      if (!p.active || p.hp <= 0) continue;
      if (p.inv > 0 && !(p.hit > 0) && ((frame >> 2) & 1)) continue; // parpadeo tras el golpe
      const parts = A.kathy[p.row][p.facing];
      const px = p.x >> 8, py = p.y >> 8;
      const vis = p.tp ? tpParts(p) : null;
      for (let k = 0; k < 4; k++) {
        if (vis && !vis[k]) continue;
        put(px + (k & 1) * 8, py + (k >> 1) * 8, parts[k], p.hit > 0 ? PAL_HURT_P1 + p.id : p.id);
      }
    }
    drawPortals(false);
    for (const b of bullets) put(b.x >> 8, b.y >> 8, A.bullet[0], 3);
    for (const e of enemies) {
      const row = e.moving ? ((e.animT / CFG.enemyAnimFrames) | 0) & 1 : 0;
      put(e.x >> 8, e.y >> 8, A.enemy[row][e.dir][0], e.hit > 0 ? PAL_HURT_EN : 2);
    }
  }

  function hudText() {
    if (gameOver) return "      GAME OVER     ";
    const side = (p) => {
      if (!p.active) return p.id + 1 + "       ";
      const hearts = "hhh".slice(0, Math.max(0, p.hp)).padEnd(3, " ");
      return (p.id + 1) + hearts + " c" + String(Math.min(99, p.coins)).padStart(2, "0");
    };
    return side(players[0]) + " W" + String(wave).padStart(2, "0") + " " + side(players[1]);
  }

  function render() {
    buildOam();
    drawHud(hudText());
    gbc.scy = cam.y;
    gbc.onScanline = (ly, g) => {
      g.scx = cam.x + (wobble ? Math.round(Math.sin((ly + frame * 0.6) / 5) * 1.5) : 0);
      // paleta BG 7: explosion en el area de juego, HUD en la ultima fila
      if (ly === 0) g.setBgPalette(7, BLAST_PALS[blastAge * 2 < CFG.blastFrames ? 0 : 1]);
      else if (ly === VIEW_H) g.setBgPalette(7, HUD_PAL);
    };
    // las celdas en explosion usan la paleta 7 solo durante este render (escritura de atributos en VBlank)
    const saved = [];
    for (const cell of blasts.keys()) { saved.push(cell, gbc.mapAttr[0][cell]); gbc.mapAttr[0][cell] = (gbc.mapAttr[0][cell] & ~7) | 7; }
    gbc.renderFrame();
    for (let i = 0; i < saved.length; i += 2) gbc.mapAttr[0][saved[i]] = saved[i + 1];
    if (debug) drawDebug();
    if ((frame & 7) === 0) {
      const s = gbc.stats;
      info.textContent = `OAM ${s.oamUsed}/40 · max sprites en una linea ${s.maxLine}/10 · ` +
        `perdidos esta frame ${s.lostSprites} (${s.linesOver} lineas) · enemigos ${enemies.length} · oleada ${wave}`;
    }
  }

  function drawDebug() {
    const c = gbc.ctx;
    c.save();
    c.translate(-cam.x, -cam.y);
    c.fillStyle = "rgba(255,0,0,0.28)";
    for (let ty = cam.y >> 3; ty <= (cam.y + 144) >> 3 && ty < MAP_H; ty++)
      for (let tx = cam.x >> 3; tx <= (cam.x + 160) >> 3 && tx < MAP_W; tx++)
        if (solid[ty * MAP_W + tx]) c.fillRect(tx * 8, ty * 8, 8, 8);
    c.lineWidth = 1;
    const box = (x, y, b, col) => { c.strokeStyle = col; c.strokeRect((x >> 8) + b.x + 0.5, (y >> 8) + b.y + 0.5, b.w - 1, b.h - 1); };
    for (const p of players) if (p.active && p.hp > 0) box(p.x, p.y, PBOX, "#0f0");
    for (const e of enemies) box(e.x, e.y, EBOX, "#ff0");
    for (const b of bullets) box(b.x, b.y, BBOX, "#0ff");
    c.restore();
  }

  // ------------------------------------------------------------------ bucle
  const info = document.getElementById("info");
  function fit() {
    const s = Math.max(1, Math.floor(Math.min(window.innerWidth / 160, (window.innerHeight - 230) / 144)));
    canvas.style.width = 160 * s + "px";
    canvas.style.height = 144 * s + "px";
  }
  window.addEventListener("resize", fit);
  fit();

  input.extraKeyHandlers.Digit1 = () => { debug = !debug; };
  input.extraKeyHandlers.Digit2 = () => { gbc.lcdCorrection = !gbc.lcdCorrection; };
  input.extraKeyHandlers.Digit3 = () => { wobble = !wobble; };
  input.extraKeyHandlers.Digit4 = () => {
    const p = players[0];
    for (let i = 0; i < 8; i++) spawnEnemyAt((p.x >> 8) + 24 + i * 2, (p.y >> 8) - 20 + (i & 3) * 3);
  };
  input.extraKeyHandlers.KeyP = () => { paused = !paused; };

  // Panel de ajustes bajo la pantalla (modifican CFG en caliente)
  const TWEAKS = [
    ["fireRate", "Disparos por segundo", 0.5, 10, 0.5],
    ["playerSpeed", "Velocidad personaje (px/frame)", 0.25, 3, 0.05],
    ["enemySpeed", "Velocidad enemigos (px/frame)", 0.05, 2, 0.05],
    ["chaseRange", "Distancia de persecución (tiles)", 1, 20, 0.5],
    ["blastRadius", "Radio de la explosión (tiles)", 0.5, 4, 0.5],
    ["wanderFactor", "Vel. al vagar (x persecución)", 0, 1, 0.05],
    ["speedJitter", "Variación de vel. enemigos (±)", 0, 0.5, 0.05],
    ["tpDistance", "Distancia teleport (tiles)", 1, 6, 0.5],
    ["tpStepFrames", "Frames por paso del teleport", 1, 12, 1],
    ["portalHold", "Duración portales (pasos)", 1, 15, 1],
    ["fuseRadius", "Espoleta de la bala (px)", 0, 16, 1],
    ["waveBase", "Enemigos en la 1ª oleada", 1, 30, 1],
    ["wavePerWave", "Enemigos extra por oleada", 0, 10, 1],
    ["waveMax", "Máx. enemigos por oleada", 1, 40, 1],
  ];
  const tw = document.getElementById("tweaks");
  for (const [key, label, min, max, step] of TWEAKS) {
    const row = document.createElement("label");
    const name = document.createElement("span"); name.textContent = label;
    const sl = document.createElement("input");
    sl.type = "range"; sl.min = min; sl.max = max; sl.step = step; sl.value = CFG[key];
    const val = document.createElement("b"); val.textContent = CFG[key];
    sl.addEventListener("input", () => { CFG[key] = parseFloat(sl.value); val.textContent = sl.value; });
    sl.addEventListener("change", () => sl.blur());   // que el teclado siga siendo del juego
    sl.addEventListener("pointerup", () => sl.blur());
    row.append(name, sl, val);
    tw.append(row);
  }

  resetGame();
  const STEP = 1000 / 59.7275;  // frecuencia real de la GBC
  let last = performance.now(), acc = 0;
  function loop(now) {
    acc += Math.min(now - last, 100);
    last = now;
    let steps = 0;
    while (acc >= STEP && steps < 4) {
      acc -= STEP; steps++;
      if (!paused) { input.poll(); update(); frame++; }
    }
    if (steps) render();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  window.__game = { gbc, players: () => players, enemies: () => enemies, bullets: () => bullets, blasts: () => blasts, cam, CFG }; // para depurar en consola
})();
