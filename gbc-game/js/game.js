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
    // Velocidades y multiplicadores en 8.8 (256 = 1 px/frame o x1.0)
    playerSpeed: 256,
    enemySpeed: 26,
    chaseRange: 5,
    blastRadius: 12, // pixeles
    fuseRadius: 8,
    blastFrames: 10,
    wanderFactor: 128,
    speedJitter: 26,
    teleportDistance: 2,
    teleportCooldown: 40,
    teleportStepFrames: 4,
    teleportEffectFrames: 32,
    hurtFlash: 6,
    barrierHp: 3,
    bulletSpeed: 3 * 256,
    bulletRange: 88,
    bulletGroundOffset: 8,
    fireDelay: 40, // frames entre disparos
    ammoMax: 25,
    reloadFrames: 240,
    specialCharge: 2400,
    specialFrames: 240,
    specialTickFrames: 30,
    specialDamage: 1,
    volume: 0.5, // solo audio web
    nudgePixels: 3,
    // Objetos del mapa que aparecen al cargar (el resto de ubicaciones se descarta al azar).
    crystalCount: 1,
    chestCount: 4,
    manaBoxCount: 4,
    // Cantidad de enemigos por oleada: waveBase + (oleada-1) * wavePerWave, hasta waveMax.
    waveBase: 30,
    wavePerWave: 10,
    waveMax: 120,
    // Limites de dibujado tipo Game Boy: si se superan, los sobrantes parpadean (rotan cada frame).
    maxSprites: 40,
    maxSpritesPerLine: 10,
    // Tipos de enemigo: weight = frecuencia relativa de aparicion, speed = multiplicador de enemySpeed.
    enemyTypes: {
      slime: { weight: 10, hp: 2, speed: 256, size: 8, flying: false, sprite: "enemyImage" },
      bigSlime: { weight: 1, hp: 4, speed: 128, size: 16, flying: false, sprite: "bigSlugImage" },
      bee: { weight: 3, hp: 1, speed: 1280, size: 8, flying: true, sprite: "beeImage" },
    },
    playerHp: 4,
    enemyHp: 2,
    invuln: 60,
    runAnimFrames: 6,
    pushAnimFrames: 8,
    pushUpFrames: 9,
    pushSideFrames: 30,
    enemyAnimFrames: 14,
    wavePause: 90,
  };
  // ------------------------------------------------------------ Ajustes del jugador (idioma y volumenes 0-5)
  const settings = { lang: 0, master: 5, music: 4, sfx: 5 };
  try { Object.assign(settings, JSON.parse(localStorage.getItem("raidersSettings") || "{}")); } catch (err) { /* sin almacenamiento */ }
  function saveSettings() { try { localStorage.setItem("raidersSettings", JSON.stringify(settings)); } catch (err) { /* sin almacenamiento */ } }

  // ------------------------------------------------------------ Sonido chiptune (WebAudio, ondas cuadradas y ruido)
  let audioCtx = null, noiseBuf = null;
  function initAudio() {
    if (audioCtx) { if (audioCtx.state === "suspended") audioCtx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audioCtx = new AC();
    noiseBuf = audioCtx.createBuffer(1, audioCtx.sampleRate, audioCtx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  window.addEventListener("keydown", initAudio);
  window.addEventListener("pointerdown", initAudio);
  window.addEventListener("gamepadconnected", initAudio);

  // Tono: barrido de frecuencia f0->f1 durante dur segundos. duty: 0.125/0.25/0.5 aprox. con onda cuadrada.
  function tone(f0, f1, dur, vol, type, delay) {
    if (!audioCtx || audioCtx.state !== "running" || !CFG.volume || !settings.master || !settings.sfx) return;
    const t = audioCtx.currentTime + (delay || 0);
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(vol * CFG.volume * (settings.master / 5) * (settings.sfx / 5), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(audioCtx.destination);
    let src;
    if (type === "noise") {
      src = audioCtx.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;
      src.playbackRate.setValueAtTime(f0, t);
      src.playbackRate.linearRampToValueAtTime(f1, t + dur);
    } else {
      src = audioCtx.createOscillator();
      src.type = "square";
      src.frequency.setValueAtTime(f0, t);
      src.frequency.exponentialRampToValueAtTime(f1, t + dur);
    }
    src.connect(g);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  const SFX = {
    shot: () => { tone(900, 200, 0.12, 0.25, "square"); tone(3, 1, 0.08, 0.15, "noise"); },
    explosion: () => tone(1.2, 0.2, 0.25, 0.35, "noise"),
    hit: () => tone(300, 150, 0.06, 0.2, "square"),
    enemyDie: () => { tone(600, 100, 0.2, 0.25, "square"); tone(2, 0.5, 0.15, 0.15, "noise"); },
    hurt: () => { tone(400, 80, 0.3, 0.3, "square"); tone(1.5, 0.3, 0.2, 0.2, "noise"); },
    coin: () => { tone(988, 988, 0.07, 0.2, "square"); tone(1319, 1319, 0.15, 0.2, "square", 0.07); },
    heart: () => { tone(523, 523, 0.08, 0.2, "square"); tone(659, 659, 0.08, 0.2, "square", 0.08); tone(784, 784, 0.15, 0.2, "square", 0.16); },
    teleport: () => tone(200, 1600, 0.18, 0.2, "square"),
    reload: () => { tone(300, 300, 0.05, 0.2, "square"); tone(500, 500, 0.08, 0.2, "square", 0.1); },
    empty: () => tone(150, 150, 0.06, 0.2, "square"),
    special: () => { tone(120, 900, 0.5, 0.3, "square"); tone(1, 3, 0.5, 0.2, "noise"); },
    open: () => { tone(440, 880, 0.12, 0.2, "square"); tone(880, 1760, 0.2, 0.2, "square", 0.12); },
  };
  function sfx(name) { try { SFX[name](); } catch (err) { /* sin audio */ } }

  const DIAG = 181; // 256 * 0.7071

  // Panel de ajuste en tiempo real: un slider por cada numero de CFG (y de CFG.enemyTypes).
  (function buildTuningPanel() {
    const panel = document.getElementById("tuning");
    if (!panel) return;
    const addSlider = (group, obj, key, label, fixedMax) => {
      const def = obj[key];
      const frac = !Number.isInteger(def);
      const max = fixedMax || (def === 0 ? 10 : Math.abs(def) * 4);
      const row = document.createElement("label");
      const name = document.createElement("span");
      name.textContent = label;
      const input = document.createElement("input");
      input.type = "range";
      input.min = 0;
      input.max = frac ? Math.ceil(max * 100) / 100 : Math.ceil(max);
      input.step = frac ? (Math.abs(def) < 1 ? 0.01 : 0.05) : 1;
      input.value = def;
      const val = document.createElement("b");
      val.textContent = def;
      input.addEventListener("input", () => { obj[key] = Number(input.value); val.textContent = input.value; });
      input.addEventListener("change", () => input.blur());
      row.append(name, input, val);
      group.appendChild(row);
    };
    const addGroup = (title, obj, prefix) => {
      const group = document.createElement("fieldset");
      const legend = document.createElement("legend");
      legend.textContent = title;
      group.appendChild(legend);
      for (const key of Object.keys(obj)) {
        if (typeof obj[key] === "number" && !(obj === CFG && key.startsWith("wave") && key !== "wavePause")) addSlider(group, obj, key, prefix + key);
      }
      panel.appendChild(group);
    };
    const waves = document.createElement("fieldset");
    const wl = document.createElement("legend");
    wl.textContent = "Enemigos por oleada";
    waves.appendChild(wl);
    const WAVE_KEYS = { waveBase: "enemigos oleada 1", wavePerWave: "extra por oleada", waveMax: "maximo por oleada" };
    for (const k of Object.keys(WAVE_KEYS)) addSlider(waves, CFG, k, WAVE_KEYS[k], 300);
    panel.appendChild(waves);
    addGroup("Juego", CFG, "");
    for (const t of Object.keys(CFG.enemyTypes)) addGroup("Enemigo: " + t, CFG.enemyTypes[t], "");
  })();

  // Hitboxes
  const PBOX = { x: 4, y: 10, w: 8, h: 6 };
  const EBOX = { x: 1, y: 1, w: 6, h: 6 };
  const BBOX = { x: 0, y: 0, w: 1, h: 1 };

  const DIRS = [[-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1]];
  const DIR_INDEX = [];
  // Pixel claro de la punta del bazooka dentro del sprite 16x16, por direccion: [filas 0/2/4, filas 1/3].
  const BAZOOKA_TIP = [
    [[1, 8], [1, 7]], [[3, 3], [2, 3]], [[6, 2], [6, 1]], [[11, 1], [11, 2]],
    [[9, 2], [9, 1]], [[12, 3], [13, 3]], [[14, 8], [14, 7]], [[4, 11], [4, 10]],
  ];
  DIRS.forEach((d, i) => { DIR_INDEX[(d[1] + 1) * 3 + (d[0] + 1)] = i; });

  // ------------------------------------------------------------ Aritmetica entera (sin coma flotante)
  // Angulos de 0-255 (256 = vuelta completa, 0 = derecha, 64 = abajo). Valores en 8.8 (256 = 1.0).
  const mulf = (a, b) => (a * b) >> 8;
  const SIN_TAB = new Int16Array(256); // tabla constante (en ROM en la consola)
  for (let i = 0; i < 256; i++) SIN_TAB[i] = Math.round(Math.sin(i * Math.PI / 128) * 256);
  const sinb = (a) => SIN_TAB[a & 255];
  const cosb = (a) => SIN_TAB[(a + 64) & 255];
  // Angulo de cada direccion de DIRS y su vector unitario en 8.8
  const DIR_ANG = DIRS.map((d, i) => (96 + 32 * i) & 255);
  const DIRU = DIR_ANG.map((a) => [cosb(a), sinb(a)]);
  // Octante 0-7 (DIRS) mas cercano a un angulo
  const dirFromAngle = (a) => (5 + (((a + 16) >> 5) & 7)) & 7;
  // atan2 aproximado en angulos de 0-255 (error < 1 unidad)
  function atan2b(y, x) {
    if (!x && !y) return 0;
    const ax = x < 0 ? -x : x, ay = y < 0 ? -y : y;
    const lo = ay <= ax ? ay : ax, hi = ay <= ax ? ax : ay;
    const r = ((lo << 8) / hi) | 0; // 0-256
    let a = (32 * r + 11 * ((r * (256 - r)) >> 8)) >> 8; // atan(r) ~ r*(pi/4 + 0.273*(1-r))
    if (ay > ax) a = 64 - a;
    if (x < 0) a = 128 - a;
    if (y < 0) a = (256 - a) & 255;
    return a & 255;
  }
  // Generador pseudoaleatorio xorshift de 16 bits (determinista, sin Math.random)
  let rngState = 0xACE1;
  function rand16() {
    rngState ^= (rngState << 7) & 0xFFFF;
    rngState ^= rngState >> 9;
    rngState ^= (rngState << 8) & 0xFFFF;
    return rngState;
  }
  const rnd = (n) => (rand16() * n) >> 16; // 0..n-1
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) { const j = rnd(i + 1); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    return arr;
  }

  let MAP_W = 32, MAP_H = 32;
  const HUD_H = 16;
  const VIEW_H = 144 - HUD_H;
  let assets;

  // ------------------------------------------------------------ Tablas de Colisiones
  const COL_TOTAL = new Set([
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37,
    38, 39, 40, 41, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 94, 95, 96,
    97, 98, 99, 100, 101, 102, 103
  ]);

  const COL_MEDIA = new Set([
    8, 9, 10, 11, 12, 13, 19, 20, 21, 22, 23, 42, 43, 44, 45, 46, 73, 104, 105
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
    coinAnim.delete(idx);
    releaseComposite(idx);
    syncMapCell(idx);
    if (needsComposite(gid) || fondoClear(idx)) setComposite(idx, 0);
  }

  // ------------------------------------------------------------ Tiles compuestos (suelo + tile con transparencia)
  // Los items con transparencia, las monedas y los avisos se dibujan como un unico tile pre-compuesto
  // (suelo + item) en un buffer de tiles; el hueco se libera cuando el item desaparece.
  const COMP_SLOTS = 96; // ids 160-255 (filas 6-8 del tileset, libres)
  const COIN_TILE = 25, FALL_FRAMES = 6;
  const ALERT_CHEST = 93, ALERT_CRYSTAL = [126, 127];
  const compSlot = new Map(), compFree = [], coinAnim = new Map(), transparentTiles = new Set();
  let compCv = null, compCtx = null;

  function initComposites() {
    compCv = document.createElement("canvas");
    compCv.width = COMP_SLOTS * 8;
    compCv.height = 8;
    compCtx = compCv.getContext("2d");
    const ts = assets.tilesetImage;
    const cv = document.createElement("canvas");
    cv.width = ts.width;
    cv.height = ts.height;
    const c = cv.getContext("2d");
    c.drawImage(ts, 0, 0);
    const px = c.getImageData(0, 0, cv.width, cv.height).data;
    const cols = cv.width >> 3;
    for (let id = 0; id < cols * (cv.height >> 3); id++) {
      const x0 = (id % cols) * 8, y0 = ((id / cols) | 0) * 8;
      let clear = false;
      for (let y = 0; y < 8 && !clear; y++) for (let x = 0; x < 8; x++) if (px[((y0 + y) * cv.width + x0 + x) * 4 + 3] < 255) { clear = true; break; }
      if (clear) transparentTiles.add(id);
    }
    resetComposites();
  }

  const needsComposite = (id) => id >= 0 && compCtx !== null &&
    (transparentTiles.has(id) || id === COIN_TILE || id === ALERT_CHEST || id === ALERT_CRYSTAL[0] || id === ALERT_CRYSTAL[1]);

  const fondoClear = (idx) => compCtx !== null && fondoLayer[idx] >= 0 && transparentTiles.has(fondoLayer[idx]);

  // Suelo opaco que hay detras de un tile de fondo transparente: el mas frecuente entre sus vecinos.
  function baseFloor(idx) {
    const tx = idx % MAP_W, ty = (idx / MAP_W) | 0, cnt = new Map();
    for (const [ox, oy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const x = tx + ox, y = ty + oy;
      if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) continue;
      const id = fondoLayer[y * MAP_W + x];
      if (id >= 0 && !transparentTiles.has(id)) cnt.set(id, (cnt.get(id) || 0) + 1);
    }
    let best = 49, bc = 0;
    for (const [id, c] of cnt) if (c > bc) { best = id; bc = c; }
    return best;
  }

  function resetComposites() {
    coinAnim.clear();
    compSlot.clear();
    compFree.length = 0;
    for (let i = COMP_SLOTS - 1; i >= 0; i--) compFree.push(i);
    for (let idx = 0; idx < itemsLayer.length; idx++) if (needsComposite(itemsLayer[idx]) || fondoClear(idx)) setComposite(idx, 0);
  }

  function drawTileInto(c, id, attr, ox, oy) {
    c.save();
    c.translate(ox + 4, oy + 4);
   if (attr & 0x20) c.scale(-1, 1);
    if (attr & 0x40) c.scale(1, -1);
    c.drawImage(assets.tilesetImage, (id % 32) * 8, ((id / 32) | 0) * 8, 8, 8, -4, -4, 8, 8);
    c.restore();
  }

  // Compone suelo + item en el hueco de la celda; dy desplaza el item (1 pixel arriba = -1).
  function setComposite(idx, dy, noItem = false) {
    let slot = compSlot.get(idx);
    if (slot === undefined) {
      if (!compFree.length) return false;
      slot = compFree.pop();
      compSlot.set(idx, slot);
    }
    const x = slot * 8;
    compCtx.clearRect(x, 0, 8, 8);
    compCtx.save();
    compCtx.beginPath();
    compCtx.rect(x, 0, 8, 8);
    compCtx.clip();
    if (fondoClear(idx)) drawTileInto(compCtx, baseFloor(idx), 0, x, 0);
    if (fondoLayer[idx] >= 0) drawTileInto(compCtx, fondoLayer[idx], fondoAttrs[idx], x, 0);
    if (!noItem && itemsLayer[idx] >= 0) drawTileInto(compCtx, itemsLayer[idx], itemsAttrs[idx], x, dy);
    compCtx.restore();
    return true;
  }

  function releaseComposite(idx) {
    const slot = compSlot.get(idx);
    if (slot === undefined) return;
    compSlot.delete(idx);
    compFree.push(slot);
  }

  // Cada moneda cae en su celda o, al azar, un tile a izquierda/derecha y/o uno mas abajo (si esta libre),
  // y se voltea al azar (espejo) para que no queden todas iguales.
  function pickCoinCell(idx) {
    const tx0 = idx % MAP_W, ty0 = (idx / MAP_W) | 0;
    const dx = rnd(3) - 1, dy = rnd(2);
    const tries = [[dx, dy], [dx, 0], [0, dy], [0, 0]];
    for (const [ox, oy] of tries) {
      const tx = tx0 + ox, ty = ty0 + oy;
      if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) continue;
      const t = ty * MAP_W + tx;
      if (itemsLayer[t] === -1 && getCellCollision(tx, ty) === 0) return t;
    }
    return -1;
  }

  // Una moneda cae: primero el tile con la moneda 1 px arriba (0,1 s) y despues en su sitio.
  // Con mas de 2 monedas a la vez se sueltan en grupos de 1-3 separados por 1-2 frames.
  function spawnCoins(cells) {
    let delay = 0;
    for (let i = 0; i < cells.length;) {
      const n = cells.length > 2 ? 1 + rnd(3) : cells.length;
      for (let k = 0; k < n && i < cells.length; k++, i++) {
        const idx = pickCoinCell(cells[i]);
        if (idx < 0) continue;
        releaseComposite(idx);
        itemsLayer[idx] = COIN_TILE;
        itemsAttrs[idx] = rnd(2) ? 0x20 : 0;
        syncMapCell(idx);
        if (fondoClear(idx)) setComposite(idx, 0, true);
        coinAnim.set(idx, { delay, fall: false, t: 0 });
      }
      delay += 1 + rnd(2);
    }
  }

  function updateCoins() {
    for (const [idx, a] of coinAnim) {
      if (a.delay > 0) { a.delay--; if (a.delay > 0) continue; }
      if (!a.fall) {
        a.fall = true;
        if (!setComposite(idx, -1)) coinAnim.delete(idx);
      } else if (++a.t >= FALL_FRAMES) {
        setComposite(idx, 0);
        coinAnim.delete(idx);
      }
    }
  }
  const coinWaiting = (idx) => { const a = coinAnim.get(idx); return a !== undefined && !a.fall; };

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
        let col = 0;
        if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) col = 2;
        else {
          const idx = ty * MAP_W + tx;
          const top = ty * 8;
          // Colisiones parciales: 36 solo mitad superior; 64 y 65 solo mitad inferior.
          const layerCol = (id) => {
            const c = getTileCollision(id);
            if (c === 0) return 0;
            if (id === 36 && t >= top + 4) return 0;
            if ((id === 64 || id === 65) && bt < top + 4) return 0;
            return c;
          };
          col = Math.max(layerCol(itemsLayer[idx]), layerCol(fondoLayer[idx]));
        }
        if (col === 2) return true;
        if (col === 1 && !isFlying) return true;
      }
    }
    return false;
  }

  function tryMove(e, dx, dy, box, limitToCam, extra) {
    let moved = false;
    const nx = e.x + dx;
    if (dx && !boxBlocked(nx >> 8, e.y >> 8, box, !!e.flying, limitToCam) && !(extra && extra(nx >> 8, e.y >> 8))) {
      e.x = nx;
      moved = true;
    } else if (dx && !dy && nudge(e, nx, e.y, 0, box, limitToCam, extra)) {
      e.x = nx;
      moved = true;
    }
    const ny = e.y + dy;
    if (dy && !boxBlocked(e.x >> 8, ny >> 8, box, !!e.flying, limitToCam) && !(extra && extra(e.x >> 8, ny >> 8))) {
      e.y = ny;
      moved = true;
    } else if (dy && !dx && nudge(e, e.x, ny, 1, box, limitToCam, extra)) {
      e.y = ny;
      moved = true;
    }
    return moved;
  }

  // Si el avance solo choca por 1 pixel, desplaza 1 pixel en el eje perpendicular para esquivar la esquina.
  function nudge(e, nx, ny, axis, box, limitToCam, extra) {
    const free = (x, y) => !boxBlocked(x, y, box, !!e.flying, limitToCam) && !(extra && extra(x, y));
    for (let d = 1; d <= CFG.nudgePixels; d++) {
      for (const s of [1, -1]) {
        const sx = axis === 0 ? 0 : s * d, sy = axis === 0 ? s * d : 0;
        if (free((nx >> 8) + sx, (ny >> 8) + sy) && free((e.x >> 8) + sx, (e.y >> 8) + sy)) {
          // Avanza solo 1 pixel por frame hacia el hueco libre.
          e.x += Math.sign(sx) * 256;
          e.y += Math.sign(sy) * 256;
          return true;
        }
      }
    }
    return false;
  }
  function enemyBlocks(enemy, nx, ny) {
    const ox = enemy.x >> 8;
    const oy = enemy.y >> 8;
    return enemies.some((other) =>
      other !== enemy &&
      other.hp > 0 &&
      overlap(nx, ny, enemy.box, other.x >> 8, other.y >> 8, other.box) &&
      !overlap(ox, oy, enemy.box, other.x >> 8, other.y >> 8, other.box)
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
  const barrierHp = new Map();
  const barrierHit = new Map();
  let coinChests = [];
  let crystals = [];
  let doors = [];

  // Las posiciones de la capa Items son candidatas: al cargar se eligen al azar solo algunas.
  function cullItems() {
    const groups = { crystal: [], chest: [], mana: [] };
    const at = (i) => itemsLayer[i];
    for (let ty = 0; ty < MAP_H - 1; ty++) {
      for (let tx = 0; tx < MAP_W - 1; tx++) {
        const i = ty * MAP_W + tx;
        const t = at(i);
        if (t === 27 && at(i + 1) === 28 && at(i + MAP_W) === 59 && at(i + MAP_W + 1) === 60) {
          groups.mana.push([i, i + 1, i + MAP_W, i + MAP_W + 1]);
        } else if (t === 29 && at(i + 1) === 29 && at(i + MAP_W) === 61 && at(i + MAP_W + 1) === 61 && (tx === 0 || at(i - 1) !== 29)) {
          groups.chest.push([i, i + 1, i + MAP_W, i + MAP_W + 1]);
        } else if (t === 30 && ty + 2 < MAP_H && at(i + 1) === 31 && at(i + MAP_W) === 62 && at(i + MAP_W + 1) === 63 &&
                   at(i + MAP_W * 2) === 94 && at(i + MAP_W * 2 + 1) === 95) {
          groups.crystal.push([i, i + 1, i + MAP_W, i + MAP_W + 1, i + MAP_W * 2, i + MAP_W * 2 + 1]);
        }
      }
    }
    const keep = { crystal: CFG.crystalCount, chest: CFG.chestCount, mana: CFG.manaBoxCount };
    for (const kind of Object.keys(groups)) {
      const list = groups[kind];
      for (let i = list.length - 1; i > 0; i--) {
        const j = rnd(i + 1);
        [list[i], list[j]] = [list[j], list[i]];
      }
      for (const cells of list.slice(Math.max(0, keep[kind]))) for (const c of cells) setItemTile(c, -1);
    }
  }

  function initInteractives() {
    cullItems();    spikes = [];
    manaBoxes = [];
    coinChests = [];
    crystals = [];

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
        // Cristal: 30,31 / 62,63 / 94,95.
        else if (
          t === 30 && tx + 1 < MAP_W && ty + 2 < MAP_H &&
          itemsLayer[idx + 1] === 31 &&
          itemsLayer[idx + MAP_W] === 62 && itemsLayer[idx + MAP_W + 1] === 63 &&
          itemsLayer[idx + MAP_W * 2] === 94 && itemsLayer[idx + MAP_W * 2 + 1] === 95
        ) {
          crystals.push({ tx, ty, pushTime: 0, mined: false });
        }
        // Puerta vertical abierta: de arriba hacia abajo, 70, 69, 68.
        else if (
          (t === 70 || t === 72) && ty + 3 < MAP_H &&
          (itemsLayer[idx + MAP_W] === 69 || itemsLayer[idx + MAP_W] === 71) &&
          itemsLayer[idx + MAP_W * 2] === 68
        ) {
          const openTiles = [idx, idx + MAP_W, idx + MAP_W * 2];
          const width = 3;
          const baseAttr = itemsAttrs[idx] & ~0x20;
          const cells = [];
          const tiles = [];
          const attrs = [];
          for (let row = 0; row < 2; row++) {
            for (let col = 0; col < width; col++) {
              const last = col === width - 1;
              cells.push((ty + 2 + row) * MAP_W + tx + col);
              tiles.push(col === 0 || last ? (row ? 96 : 64) : (row ? 97 : 65));
              attrs.push(last ? baseAttr | 0x20 : baseAttr);
            }
          }
          doors.push({
            tx,
            ty: ty + 2,
            shifted: true,
            width,
            pushTime: 0,
            open: true,
            openTopY: ty,
            openTiles,
            openAttrs: openTiles.map((cell) => itemsAttrs[cell]),
            openIds: openTiles.map((cell) => itemsLayer[cell]),
            pushIds: [t === 72 ? 103 : 101, itemsLayer[idx + MAP_W] === 71 ? 102 : 100, 68],
            cells,
            tiles,
            attrs,
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

  function playerPushing(p, box, upOnly = false) {
    if (!p.active || p.hp <= 0 || p.tp) return false;
    const held = input.held[p.id];
    const dx = ((held & BTN.RIGHT) ? 1 : 0) - ((held & BTN.LEFT) ? 1 : 0);
    const dy = ((held & BTN.DOWN) ? 1 : 0) - ((held & BTN.UP) ? 1 : 0);
    if (!dx && !dy) return false;
    if (upOnly && !(dy < 0 && !dx)) return false;

    const interactionBox = { x: box.x - 6, y: box.y - 6, w: box.w + 12, h: box.h + 12 };
    if (!overlap(p.x >> 8, p.y >> 8, PBOX, 0, 0, interactionBox)) return false;

    const playerCenterX = (p.x >> 8) + 8;
    const playerCenterY = (p.y >> 8) + 13;
    const targetX = box.x + box.w / 2;
    const targetY = box.y + box.h / 2;
    if (dx * (targetX - playerCenterX) + dy * (targetY - playerCenterY) <= 0) return false;
    p.pushing = true;
    p.pushFacing = DIR_INDEX[(dy + 1) * 3 + (dx + 1)];
    if (upOnly) p.pushAnim = "up";
    else if (dx) p.pushAnim = dx > 0 ? "right" : "left";
    else if (dy < 0) p.pushAnim = "up";
    return true;
  }

  function openCoinChest(chest, player) {
    chest.opened = true;
    player.coins += 5;
    sfx("coin");

    const chestCells = [];
    for (let oy = 0; oy < 2; oy++) {
      for (let ox = 0; ox < 2; ox++) {
        const idx = (chest.ty + oy) * MAP_W + chest.tx + ox;
        chestCells.push(idx);
        setItemTile(idx, -1);
      }
    }

    const coinCells = chestCells.slice();

    let extraCoins = 0;
    for (let radius = 1; radius <= 2 && extraCoins < 8; radius++) {
      for (let oy = -radius; oy <= 1 + radius && extraCoins < 8; oy++) {
        for (let ox = -radius; ox <= 1 + radius && extraCoins < 8; ox++) {
          if (Math.max(
            Math.abs(2 * ox - 1),
            Math.abs(2 * oy - 1)
          ) < 2 * radius) continue;

          const tx = chest.tx + ox;
          const ty = chest.ty + oy;
          if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) continue;
          const idx = ty * MAP_W + tx;
          if (itemsLayer[idx] !== -1 || getCellCollision(tx, ty) !== 0) continue;

          coinCells.push(idx);
          extraCoins++;
        }
      }
    }
    spawnCoins(coinCells);
  }

  function updateInteractives() {
    for (const p of players) { p.pushing = false; p.pushAnim = null; }

    for (const b of manaBoxes) if (b.hit > 0) b.hit--;
    for (const [k, v] of barrierHit) { if (v <= 1) barrierHit.delete(k); else barrierHit.set(k, v - 1); }

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
            sfx("hurt");
            p.inv = invulnFrames();
            p.hit = CFG.hurtFlash;
          }
        }
        for (const e of enemies) {
          if (e.hp > 0 && overlap(e.x >> 8, e.y >> 8, e.box, sBox.x, sBox.y, sBox)) {
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
      const pusher = players.find((p) => playerPushing(p, cBox, true));
      const topCells = [c.ty * MAP_W + c.tx, c.ty * MAP_W + c.tx + 1];
      if (pusher) {
        if (!c.saved) {
          c.saved = topCells.map((i) => [itemsLayer[i], itemsAttrs[i]]);
          topCells.forEach((i, k) => setItemTile(i, ALERT_CHEST, c.saved[k][1]));
        }
        c.pushTime++;
        if (c.pushTime >= 90) { // 1.5s empujando para abrir
          openCoinChest(c, pusher);
        }
      } else {
        if (c.saved) {
          topCells.forEach((i, k) => setItemTile(i, c.saved[k][0], c.saved[k][1]));
          c.saved = null;
        }
        c.pushTime = 0;
      }
    }

    // B2) CRISTALES (30,31,62,63,94,95): 3 veces mas lento que el cofre
    for (const c of crystals) {
      if (c.mined) continue;
      const box = { x: c.tx * 8, y: c.ty * 8, w: 16, h: 24 };
      const pusher = players.find((p) => playerPushing(p, box, true));
      const topCells = [c.ty * MAP_W + c.tx, c.ty * MAP_W + c.tx + 1];
      if (pusher) {
        if (!c.saved) {
          c.saved = topCells.map((i) => [itemsLayer[i], itemsAttrs[i]]);
          topCells.forEach((i, k) => setItemTile(i, ALERT_CRYSTAL[k], c.saved[k][1]));
        }
        c.pushTime++;
        if (c.pushTime >= 270) {
          c.mined = true;
          pusher.crystals++;
         // winDelay = 90;
          sfx("open");
          for (let oy = 0; oy < 3; oy++) {
            for (let ox = 0; ox < 2; ox++) setItemTile((c.ty + oy) * MAP_W + c.tx + ox, -1);
          }
        }
      } else {
        if (c.saved) {
          topCells.forEach((i, k) => setItemTile(i, c.saved[k][0], c.saved[k][1]));
          c.saved = null;
        }
        c.pushTime = 0;
      }
    }

    // C) PUERTAS EMPUJABLES: al abrirse, la hoja gira y queda junto al marco.
    for (const d of doors) {
      if (d.open) {
        const verticalBox = { x: d.tx * 8, y: d.openTopY * 8, w: 8, h: 24 };
        const pushing = players.some((p) => playerPushing(p, verticalBox));
        if (!pushing) { d.locked = false; d.closeTime = 0; }
        const active = pushing && !d.locked;
        const animating = active && (d.closeTime || 0) >= 24;
        const openDoorTiles = animating ? (d.pushIds || [101, 100, 68]) : (d.openIds || [70, 69, 68]);
        d.openTiles.forEach((cell, i) => setItemTile(cell, openDoorTiles[i], d.openAttrs[i]));
        if (active && d.cells) {
          d.closeTime = (d.closeTime || 0) + 1;
          const blocked = players.some((p) => p.active && p.hp > 0 &&
            overlap(p.x >> 8, p.y >> 8, PBOX, d.tx * 8, d.ty * 8, { x: 0, y: 0, w: d.width * 8, h: 16 }));
          if (d.closeTime >= 90 && !blocked) {
            d.open = false;
            d.locked = true;
            d.pushTime = 0;
            d.closeTime = 0;
            d.openTiles.forEach((cell) => setItemTile(cell, -1));
            d.skip = d.cells.map((cell) => d.shifted && getCellCollision(cell % MAP_W, (cell / MAP_W) | 0) !== 0);
            d.cells.forEach((cell, i) => { if (!d.skip[i]) setItemTile(cell, d.tiles[i], d.attrs[i]); });
          }
        }
        continue;
      }
      const hBox = { x: d.tx * 8, y: d.ty * 8, w: d.width * 8, h: 16 };
      const pushingH = players.some((p) => playerPushing(p, hBox));
      if (!pushingH) d.locked = false;
      if (pushingH && !d.locked) {
        d.pushTime++;
        if (d.pushTime >= 24) for (let col = 1; col < d.width; col++) {
          const top = d.ty * MAP_W + d.tx + col;
          const bottom = top + MAP_W;
          const isRightEdge = col === d.width - 1;
          if (!(d.skip && d.skip[col])) setItemTile(top, isRightEdge ? 67 : 66, isRightEdge ? 0 : d.attrs[col]);
          if (!(d.skip && d.skip[d.width + col])) setItemTile(bottom, isRightEdge ? 99 : 98, isRightEdge ? 0 : d.attrs[d.width + col]);
        }

        if (d.pushTime >= 90) {
          d.open = true;
          d.locked = true;
          d.cells.forEach((cell, i) => { if (!(d.skip && d.skip[i])) setItemTile(cell, -1); });
          const openDoorTiles = d.openIds || [70, 69, 68];
          d.openTiles.forEach((cell, i) => setItemTile(cell, openDoorTiles[i], d.openAttrs[i]));
        }
      } else if (d.pushTime > 0) {
        d.pushTime = 0;
        d.cells.forEach((cell, i) => { if (!(d.skip && d.skip[i])) setItemTile(cell, d.tiles[i], d.attrs[i]); });
      }
    }
  }

  function checkBulletHitItems(bx, by) {
    const tx = bx >> 3, ty = by >> 3;
    if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return false;
    const idx = ty * MAP_W + tx;
    const t = itemsLayer[idx];

    // Barreras destruibles (19 a 23): aguantan varios impactos y luego desaparecen
    if (t >= 19 && t <= 23) {
      const left = (barrierHp.get(idx) ?? CFG.barrierHp) - 1;
      if (left <= 0) {
        barrierHp.delete(idx);
        barrierHit.delete(idx);
        setItemTile(idx, -1);
      } else {
        barrierHp.set(idx, left);
        barrierHit.set(idx, CFG.hurtFlash);
      }
      return true;
    }

    // Caja de mana (27, 28, 59, 60)
    for (const b of manaBoxes) {
      if (!b.alive) continue;
      if (tx >= b.tx && tx <= b.tx + 1 && ty >= b.ty && ty <= b.ty + 1) {
        b.hp--;
        b.hit = CFG.hurtFlash;
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
  let stats = { kills: 0, time: 0, shots: 0 }, goSel = 0, selFrame = -1;

  let players = [], enemies = [], bullets = [];
  let teleportEffects = [];
  const blasts = new Map();

  function overlap(ax, ay, a, bx, by, b) {
    return ax + a.x < bx + b.x + b.w && ax + a.x + a.w > bx + b.x &&
           ay + a.y < by + b.y + b.h && ay + a.y + a.h > by + b.y;
  }

  // ------------------------------------------------------------ Mejoras (tienda entre niveles)
  let upg = {};
  const lv = (k) => upg[k] || 0;
  // Personajes: hp/speed son multiplicadores sobre Kathy; ammo multiplica el cargador.
  const CHARS = [
    { name: "KATHY", img: "playerImage", hp: 256, speed: 256, ammo: 256, weapon: "rocket", ult: "area" },
    { name: "KURT", img: "kurtImage", hp: 384, speed: 205, ammo: 922, delay: 4, dash: true, weapon: "gun", ult: "burst" },
    { name: "SKREEK", img: "skreekImage", hp: 320, speed: 294, ammo: 256, delay: 12, dash: true, weapon: "sword", ult: "beam" },
  ];
  const chars = [0, 1];
  const maxHp = (p) => ((CFG.playerHp * p.ch.hp + 128) >> 8) + lv("hp");
  const ammoMax = (p) => (((CFG.ammoMax + 10 * lv("mag")) * p.ch.ammo) + 128) >> 8;
  const RATE_MUL = [256, 205, 171, 146, 128]; // 1 / (1 + 0.25 * nivel) en 8.8
  const fireDelay = (p) => Math.max(1, mulf(p.ch.delay || CFG.fireDelay, RATE_MUL[lv("rate")]));
  const playerSpeed = (p) => mulf(mulf(CFG.playerSpeed, p.ch.speed), 256 + 26 * lv("speed"));
  const specialDamage = () => CFG.specialDamage + lv("spDmg");
  const specialSize = () => 3 + 2 * lv("spArea");
  const specialFrames = () => CFG.specialFrames + 120 * lv("spTime");
  const blastRadius = () => CFG.blastRadius + 4 * lv("blast");
  const bulletRange = () => CFG.bulletRange + 24 * lv("range");
  const reloadFrames = () => mulf(CFG.reloadFrames, 256 - 38 * lv("reload"));
  const manaRegen = () => 1 + lv("mana");
  const invulnFrames = () => CFG.invuln + 30 * lv("invuln");

  // name: texto del tileset (A-Z, �, 0-9); base: coste inicial; step: coste extra por nivel; max: niveles.
  const UPGRADES = [
    { key: "dmg", name: "DA\u00d1O BALA", base: 6, step: 4, max: 5 },
    { key: "mag", name: "CARGADOR", base: 4, step: 2, max: 5 },
    { key: "rate", name: "CADENCIA", base: 5, step: 3, max: 4 },
    { key: "speed", name: "VELOCIDAD", base: 4, step: 3, max: 4 },
    { key: "spDmg", name: "DA\u00d1O AREA", base: 6, step: 4, max: 5 },
    { key: "spArea", name: "AREA GRANDE", base: 8, step: 6, max: 2 },
    { key: "spTime", name: "TIEMPO AREA", base: 5, step: 3, max: 4 },
    { key: "hp", name: "VIDA MAX", base: 8, step: 6, max: 2 },
    { key: "blast", name: "EXPLOSION", base: 6, step: 4, max: 3 },
    { key: "range", name: "ALCANCE", base: 3, step: 2, max: 5 },
    { key: "reload", name: "RECARGA RAP", base: 5, step: 3, max: 4 },
    { key: "mana", name: "MANA RAPIDO", base: 5, step: 3, max: 3 },
    { key: "invuln", name: "INVULNERAB", base: 4, step: 3, max: 3 },
  ];
  const upgCost = (u) => u.base + u.step * lv(u.key);
  let shop = null, level = 1;
  let shopSource = "death"; // Puede ser "death"

  function totalCoins() {
    return players.reduce((n, p) => n + (p.active ? p.coins : 0), 0);
  }

  function spendCoins(n) {
    for (const p of players) {
      if (!p.active) continue;
      const t = Math.min(p.coins, n);
      p.coins -= t;
      n -= t;
    }
  }

  function rollOffers() {
    const avail = UPGRADES.filter((u) => lv(u.key) < u.max);
    const coins = totalCoins();
    const cheap = avail.filter((u) => upgCost(u) <= coins);
    if (!cheap.length) return [];
    const pick = cheap[rnd(cheap.length)];
    const rest = shuffle(avail.filter((u) => u !== pick)).slice(0, 2);
    return shuffle([pick, ...rest]);
  }

 // Modificamos openShop para que no avance de nivel, sino que mantenga el nivel actual
  function openShop(source = "death") {
    shopSource = source; // Guardamos si se abrió por morir ("death") o por ganar ("win")
    shop = { sel: 0, offers: rollOffers() };
    if (!shop.offers.length) closeShopAndContinue();
  }

  function closeShopAndContinue() {
    shop = null;
    //winDelay = 0;
    
    if (shopSource === "win") {
      // Si veníamos de ganar el nivel (llegar al END), SÍ avanzamos al siguiente nivel
      nextLevel();
    } else {
      // Si veníamos de morir, nos quedamos en el mismo nivel reviviendo
      continueGame();
    }
  }
  function nextLevel() {
    // Esto ahora solo se usará cuando se llegue a la zona END
    shop = null;
    level++;
    const saved = players.map((p) => ({ coins: p.coins, crystals: p.crystals, active: p.active }));
    resetGame(true);
    players.forEach((p, i) => { p.coins = saved[i].coins; p.crystals = saved[i].crystals; p.active = saved[i].active; });
  }

  function updateShop() {
    const pr = input.pressed[0] | input.pressed[1];
    const n = shop.offers.length;
    if (pr & BTN.UP) shop.sel = (shop.sel + n - 1) % n;
    if (pr & BTN.DOWN) shop.sel = (shop.sel + 1) % n;
    if (pr & BTN.B) { closeShopAndContinue(); return; } // Botón B para salir de la tienda y reanudar
    if (pr & (BTN.A | BTN.START)) {
      const u = shop.offers[shop.sel];
      if (upgCost(u) <= totalCoins()) {
        spendCoins(upgCost(u));
        upg[u.key] = lv(u.key) + 1;
        sfx("coin");
        for (const p of players) {
          if (u.key === "hp") p.hp = Math.min(maxHp(p), p.hp + 1);
          if (u.key === "mag") p.ammo = ammoMax(p);
        }
        shop = { sel: 0, offers: rollOffers() };
        if (!shop.offers.length) closeShopAndContinue();
      } else {
        sfx("empty");
      }
    }
  }

  function newPlayer(i, x, y) {
    const ch = CHARS[chars[i]];
    const p = { id: i, ch, x: x << 8, y: y << 8, facing: 7, hp: 0, coins: 0, crystals: 0, cd: 0, ammo: 0, reloadT: 0, mana: CFG.specialCharge, sp: null,
               inv: 0, animT: 0, row: 0, active: i === 0, hit: 0, tpCooldown: 0, slash: 0,
               pushing: false, pushFacing: 7, pushAnimT: 0 };
    p.hp = maxHp(p);
    p.ammo = ammoMax(p);
    return p;
  }

  // ------------------------------------------------------------ Niveles hechos a mano
  let allLevels = [], levelLogic = null;

  function useLayout(l) {
    levelLogic = l.logic || null;
    fondoLayer = l.fondo.slice();
    fondoAttrs = l.fondoAttrs.slice();
    for (let i = 0; i < fondoLayer.length; i++) {
      if (fondoLayer[i] < 0) { fondoLayer[i] = 49; fondoAttrs[i] = 0; }
    }
    initialItemsLayer = l.items.slice();
    initialItemsAttrs = l.itemsAttrs.slice();
  }

  let layouts = [];
  function buildLayouts() {
    layouts = shuffle(allLevels.slice());
  }

  // Posicion inicial de cada jugador: dentro del rectangulo "Start" del nivel, o fija si no lo tiene.
  function startPos(i) {
    const s = levelLogic && levelLogic.start;
    if (!s) return [[120, 160], [160, 160]][i];
    return [Math.min(s[0] + i * 16, s[0] + s[2] - 16), s[1] + ((s[3] - 16) >> 1)];
  }

  function pickLevel() {
    useLayout(layouts[(level - 1) % layouts.length]);
  }

  function resetGame(keepUpgrades) {
    if (!keepUpgrades) { upg = {}; level = 1; buildLayouts(); }
    pickLevel();
    shop = null;
    //winDelay = 0;
    itemsLayer = initialItemsLayer.slice();
    barrierHp.clear();
    barrierHit.clear();
    itemsAttrs = initialItemsAttrs.slice();
    for (let i = 0; i < MAP_W * MAP_H; i++) syncMapCell(i);
    players = [newPlayer(0, ...startPos(0)), newPlayer(1, ...startPos(1))];
    enemies = [];
    bullets = [];
    teleportEffects = [];
    blasts.clear();
    wave = 0;
    waveTimer = 60;
    gameOver = false;
    stats = { kills: 0, time: 0, shots: 0 };
    goSel = 0;
    paused = false;
    cam.x = Math.max(0, Math.min(MAP_W * 8 - 160, (players[0].x >> 8) + 8 - 80));
    cam.y = Math.max(0, Math.min(MAP_H * 8 - VIEW_H, (players[0].y >> 8) + 12 - (VIEW_H >> 1)));
    initInteractives();
    resetComposites();
  }

  const SPAWNS = [[10, 10], [20, 10], [12, 25], [22, 26], [8, 18], [18, 18], [26, 10], [6, 26]];

  function spawnEnemyAt(tileX, tileY, typeName) {
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
        bullets.push({ x: ((p.x >> 8) + tip[0]) * 256 + 128, y: ((p.y >> 8) + tip[1]) * 256 + 128, vx, vy, life: bulletRange() << 8, direct: gun });
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

      if (b.direct) {
        const hit = enemies.find((e) => e.hp > 0 && overlap(bx, by, BBOX, e.x >> 8, e.y >> 8, e.box));
        if (hit) {
          damageEnemy(hit, 1 + (lv("dmg") >> 1));
          b.dead = true;
          continue;
        }
      }

      // El disparo vuela a ~1 tile del suelo: su colision con paredes/items se calcula en el suelo.
      const gy = by + CFG.bulletGroundOffset;
      if (checkBulletHitItems(bx, gy)) {
        b.dead = true;
        continue;
      }

      if (boxBlocked(bx, gy, BBOX, true, false)) {
        b.dead = true;
        continue;
      }

      let detonated = b.direct;
      for (const e of b.direct ? [] : enemies) {
        if (e.hp <= 0) continue;
        const dx = (e.x >> 8) + 4 - bx;
        const dy = (e.y >> 8) + 4 - by;
        if (dx * dx + dy * dy <= CFG.fuseRadius * CFG.fuseRadius ||
            overlap(bx, by, BBOX, e.x >> 8, e.y >> 8, e.box)) {
          explode(bx, by);
          sfx("explosion");
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
  const hitImages = {};
  const HIT_RAMP = [0x0f380f, 0x2a4e19, 0x55742a, 0x7a953a];
  function makeHitImage(img, brighten = false) {
    try {
      const cv = document.createElement("canvas");
      cv.width = img.width;
      cv.height = img.height;
      const c = cv.getContext("2d");
      c.drawImage(img, 0, 0);
      const data = c.getImageData(0, 0, cv.width, cv.height);
      const px = data.data;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] === 0) continue;
        if (brighten) {
          for (let j = 0; j < 3; j++) px[i + j] = Math.min(255, px[i + j] + 110);
          continue;
        }
        const k = HIT_RAMP.indexOf((px[i] << 16) | (px[i + 1] << 8) | px[i + 2]);
        if (k < 0) continue;
        const n = HIT_RAMP[HIT_RAMP.length - 1 - k];
        px[i] = n >> 16; px[i + 1] = (n >> 8) & 255; px[i + 2] = n & 255;
      }
      c.putImageData(data, 0, 0);
      return cv;
    } catch (err) {
      return img;
    }
  }
  function drawMapTile(ctx, tx, ty, tileId, attr, hit = false) {
    if (tileId < 0) return;
    const screenX = tx * 8 - cam.x;
    const screenY = ty * 8 - cam.y;
    const sourceX = (tileId % 32) * 8;
    const sourceY = (tileId >> 5) * 8;
    const flags = attr || 0;
    ctx.save();
    ctx.translate(screenX + 4, screenY + 4);
   if (flags & 0x20) ctx.scale(-1, 1);
    if (flags & 0x40) ctx.scale(1, -1);
    ctx.drawImage(hit && hitImages.tileset ? hitImages.tileset : assets.tilesetImage, sourceX, sourceY, 8, 8, -4, -4, 8, 8);
    ctx.restore();
  }

  // ------------------------------------------------------------ HUD (2 tiles de alto, parte inferior)
  const GLYPH_COIN = 146, GLYPH_HEART = 147, GLYPH_DIGIT0 = 127; // digitos: 128-136 = 1-9, 137 = 0

  // Texto: los glifos de la fuente 8x8 (ancho proporcional) se componen en 32 tiles libres del tileset
  // (ids 74-92 y 106-118, transparentes en el PNG) y despues se pintan como tiles.
  const FONT_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,";
  const TEXT_IDS = [];
  for (let i = 74; i <= 92; i++) TEXT_IDS.push(i);
  for (let i = 106; i <= 118; i++) TEXT_IDS.push(i);
  const TEXT_TILES = TEXT_IDS.length, SPACE_W = 3;
  const TEXT_SLOT = new Map(TEXT_IDS.map((id, i) => [id, i]));
  const fontGlyphs = {};
  let tileBufCtx = null, lastText = null;

  function initText() {
    // Buffer de texto: solo la fila de texto del tileset; el tileset original no se toca (los mapas se dibujan desde la imagen).
    const cv = document.createElement("canvas");
    cv.width = TEXT_TILES * 8;
    cv.height = 8;
    tileBufCtx = cv.getContext("2d");
    assets.textBuffer = cv;

    const f = document.createElement("canvas");
    f.width = assets.fontImage.width;
    f.height = assets.fontImage.height;
    const fc = f.getContext("2d");
    fc.drawImage(assets.fontImage, 0, 0);
    const data = fc.getImageData(0, 0, f.width, f.height).data;
    fc.globalCompositeOperation = "source-in";
    fc.fillStyle = "#7a953a";
    fc.fillRect(0, 0, f.width, f.height);
    assets.fontTinted = f;
    for (let n = 0; n < FONT_CHARS.length; n++) {
      const cx = (n % 8) * 8, cy = (n >> 3) * 8;
      let x0 = 8, x1 = -1;
      for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) {
        if (data[((cy + y) * f.width + cx + x) * 4 + 3]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
      }
      fontGlyphs[FONT_CHARS[n]] = x1 < 0 ? { sx: cx, w: 0 } : { sx: cx + x0, w: x1 - x0 + 1 };
    }
  }

  const textNorm = (str) => String(str).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  function textWidth(str) {
    let w = 0;
    for (const ch of textNorm(str)) w += fontGlyphs[ch] ? fontGlyphs[ch].w + 1 : SPACE_W + 1;
    return Math.max(0, w - 1);
  }

  function drawText(ctx, str, x, y) {
    const s = textNorm(str);
    const w = textWidth(s);
    if (!w || !tileBufCtx) return;
    if (s !== lastText) {
    tileBufCtx.clearRect(0, 0, TEXT_TILES * 8, 8);
    let pen = 0;
    for (const ch of s) {
      const g = fontGlyphs[ch];
      if (g && g.w) tileBufCtx.drawImage(assets.fontTinted, g.sx, (FONT_CHARS.indexOf(ch) >> 3) * 8, g.w, 8, pen, 0, g.w, 8);
      pen += g ? g.w + 1 : SPACE_W + 1;
      if (pen >= TEXT_TILES * 8) break;
    }
    lastText = s;
    }
    const tiles = Math.min(TEXT_TILES, Math.ceil(w / 8));
    for (let i = 0; i < tiles; i++) drawGlyph(ctx, TEXT_IDS[i], x + i * 8, y);
  }
  const drawTextCentered = (ctx, str, y, cx = GBC_W >> 1) => drawText(ctx, str, cx - (textWidth(str) >> 1), y);

  function wrapText(str, maxW) {
    const lines = [];
    let line = "";
    for (const word of str.split(" ")) {
      const t = line ? line + " " + word : word;
      if (line && textWidth(t) > maxW) { lines.push(line); line = word; } else line = t;
    }
    if (line) lines.push(line);
    return lines;
  }

  function drawShop(ctx) {
    ctx.fillStyle = "#0f380f";
    ctx.fillRect(0, 0, GBC_W, GBC_H);
    const center = (str, y) => drawTextCentered(ctx, str, y);
    center("LEVEL WIN", 6);
    drawGlyph(ctx, GLYPH_COIN, 56, 20);
    drawText(ctx, String(totalCoins()), 64, 20);
    const coins = totalCoins();
    shop.offers.forEach((u, i) => {
      const y = 44 + i * 20;
      const afford = upgCost(u) <= coins;
      ctx.globalAlpha = afford ? 1 : 0.4;
      drawText(ctx, u.name, 14, y);
      const lvl = "NV" + lv(u.key);
      drawText(ctx, lvl, 14, y + 9);
      drawGlyph(ctx, GLYPH_COIN, 112, y + 9);
      drawText(ctx, String(upgCost(u)), 120, y + 9);
      ctx.globalAlpha = 1;
      if (i === shop.sel) {
        ctx.fillStyle = "#7a953a";
        ctx.fillRect(4, y + 2, 6, 3);
        ctx.fillRect(8, y + 1, 2, 5);
      }
    });
    if (((frame >> 4) & 1) === 0) center("B SALIR", 118);
  }

  function drawGameOver(ctx) {
    ctx.fillStyle = "rgba(15,56,15,0.85)";
    ctx.fillRect(0, 0, GBC_W, VIEW_H);
    const center = (str, y) => drawTextCentered(ctx, str, y);
    center("GAME OVER", 8);
    const secs = (stats.time * 137) >> 13;
    const mm = String((secs / 60) | 0).padStart(2, "0"), ss = String(secs % 60).padStart(2, "0");
    const rows = [
      ["OLEADA", wave],
      ["BAJAS", stats.kills],
      ["DISPAROS", stats.shots],
      ["TIEMPO", mm + ss],
    ];
    let y = 28;
    for (const [label, value] of rows) {
      drawText(ctx, label, 24, y);
      const v = String(value);
      drawText(ctx, v, 136 - textWidth(v), y);
      y += 10;
    }
    players.forEach((p, i) => {
      if (!p.active) return;
      drawGlyph(ctx, GLYPH_COIN, 24 + i * 56, y + 2);
      drawText(ctx, String(p.coins), 32 + i * 56, y + 2);
      drawGem(ctx, 56 + i * 56 - (i ? 8 : 0), y + 2);
      drawText(ctx, String(p.crystals), 64 + i * 56 - (i ? 8 : 0), y + 2);
    });
    ["CONTINUAR", "NUEVA PARTIDA"].forEach((label, i) => {
      const lx = (GBC_W - textWidth(label)) >> 1;
      const ly = 88 + i * 12;
      drawText(ctx, label, lx, ly);
      if (i === goSel) {
        ctx.fillStyle = "#7a953a";
        ctx.fillRect(lx - 8, ly + 3, 4, 2);
      }
    });
  }


  function drawGlyph(ctx, id, x, y) {
    if (TEXT_SLOT.has(id)) ctx.drawImage(assets.textBuffer, TEXT_SLOT.get(id) * 8, 0, 8, 8, x, y, 8, 8);
    else ctx.drawImage(assets.tilesetImage, (id % 32) * 8, ((id / 32) | 0) * 8, 8, 8, x, y, 8, 8);
  }

  function drawNumber(ctx, value, x, y) {
    for (const ch of String(value)) {
      const d = Number(ch);
      drawGlyph(ctx, GLYPH_DIGIT0 + (d === 0 ? 10 : d), x, y);
      x += 8;
    }
  }

  function drawGem(ctx, x, y) {
    const rows = ["..1111..", ".122221.", "12233221", "12233221", ".122221.", "..1221..", "...11...", "........"];
    const cols = { 1: "#0f380f", 2: "#55742a", 3: "#7a953a" };
    rows.forEach((row, ry) => {
      for (let rx = 0; rx < 8; rx++) {
        const ch = row[rx];
        if (ch === ".") continue;
        ctx.fillStyle = ch === "1" ? "#7a953a" : cols[ch];
        ctx.fillRect(x + rx, y + ry, 1, 1);
      }
    });
  }

  function drawHud(ctx) {
    const top = VIEW_H;
    ctx.fillStyle = "#0f380f";
    ctx.fillRect(0, top, GBC_W, HUD_H);
    for (const p of players) {
      if (!p.active) continue;
      const x0 = p.id * 80;
      for (let h = 0; h < Math.min(p.hp, 7); h++) drawGlyph(ctx, GLYPH_HEART, x0 + h * 8, top);
      drawGlyph(ctx, GLYPH_COIN, x0 + 56, top);
      drawNumber(ctx, p.coins, x0 + 64, top);
      drawGem(ctx, x0 + 56, top + 8);
      drawNumber(ctx, p.crystals, x0 + 64, top + 8);
      if (p.reloadT > 0 && ((frame >> 3) & 1)) {
        drawText(ctx, "RELOAD", x0, top + 8);
      } else {
        const full = p.mana >= CFG.specialCharge;
        ctx.fillStyle = "#55742a";
        ctx.fillRect(x0, top + 10, 48, 4);
        ctx.fillStyle = "#0f380f";
        ctx.fillRect(x0 + 1, top + 11, 46, 2);
        ctx.fillStyle = full && ((frame >> 3) & 1) ? "#7a953a" : "#55742a";
        ctx.fillRect(x0 + 1, top + 11, Math.min(46, (p.mana * 5) >> 8), 2);
      }
    }
  }

  // ------------------------------------------------------------ Renderizado a color original
  function render() {
    const ctx = gbc.ctx;
    ctx.clearRect(0, 0, GBC_W, GBC_H);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, GBC_W, GBC_H);

    if (screen !== "game") {
      const draw = { splash: drawSplash, raiders: drawRoster, sheet: drawSheet, settings: drawSettings }[screen] || drawSelect;
      draw(ctx);
      document.getElementById("info").textContent = tr({ splash: "hintSplash", raiders: "hintRaiders", sheet: "hintSheet", settings: "hintSettings" }[screen] || "hintSelect");
      return;
    }

    const firstTileX = Math.max(0, cam.x >> 3);
    const lastTileX = Math.min(MAP_W - 1, (cam.x + GBC_W - 1) >> 3);
    const firstTileY = Math.max(0, cam.y >> 3);
    const lastTileY = Math.min(MAP_H - 1, (cam.y + VIEW_H - 1) >> 3);

    const spCells = new Set();
    for (const p of players) {
      if (!p.active || !p.sp) continue;
      if (p.sp.state === "aim" && !((frame >> 3) & 1)) continue;
      for (let r = 0; r < p.sp.h; r++) for (let c = 0; c < p.sp.w; c++) spCells.add((p.sp.ty + r) * MAP_W + p.sp.tx + c);
    }

    const hitCells = new Set();
    for (const b of manaBoxes) {
      if (!b.alive || !(b.hit > 0)) continue;
      for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) hitCells.add((b.ty + r) * MAP_W + b.tx + c);
    }
    const flashed = (idx) => hitCells.has(idx) || barrierHit.has(idx) || blasts.has(idx) || spCells.has(idx);

    for (let ty = firstTileY; ty <= lastTileY; ty++) {
      for (let tx = firstTileX; tx <= lastTileX; tx++) {
        const idx = ty * MAP_W + tx;
        const fs = compSlot.get(idx);
        if (fs !== undefined && !flashed(idx)) {
          if (!coinWaiting(idx) || fondoClear(idx)) ctx.drawImage(compCv, fs * 8, 0, 8, 8, tx * 8 - cam.x, ty * 8 - cam.y, 8, 8);
          continue;
        }
        drawMapTile(ctx, tx, ty, fondoLayer[idx], fondoAttrs[idx], blasts.has(idx) || spCells.has(idx));
      }
    }

    for (let ty = firstTileY; ty <= lastTileY; ty++) {
      for (let tx = firstTileX; tx <= lastTileX; tx++) {
        const idx = ty * MAP_W + tx;
        if (itemsLayer[idx] < 0 || coinWaiting(idx)) continue;
        const slot = compSlot.get(idx);
        if (slot !== undefined && !flashed(idx)) continue;
        drawMapTile(ctx, tx, ty, itemsLayer[idx], itemsAttrs[idx], flashed(idx));
      }
    }

    for (const effect of teleportEffects) {
      const spriteFrame = Math.min(7, effect.age >> 1);
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
      const spriteColumn = p.pushAnim ? 8 : p.facing;
      const sheet = p.hit > 0 ? hitImages[p.ch.img] || assets[p.ch.img] : assets[p.ch.img];
      if (p.pushAnim === "left") {
        ctx.save();
        ctx.translate(px + 16, py);
        ctx.scale(-1, 1);
        ctx.drawImage(sheet, spriteColumn * 16, p.row * 16, 16, 16, 0, 0, 16, 16);
        ctx.restore();
      } else {
        ctx.drawImage(sheet, spriteColumn * 16, p.row * 16, 16, 16, px, py, 16, 16);
      }
      if (p.tp) ctx.globalAlpha = 1;
    }

    for (const p of players) {
      if (!p.active || !(p.slash > 0) || !p.slashRect) continue;
      const r = p.slashRect;
      ctx.fillStyle = "#fff";
      ctx.fillRect(r.x - cam.x + 2, r.y - cam.y + 2, r.w - 4, r.h - 4);
      ctx.fillStyle = "#7a953a";
      ctx.fillRect(r.x - cam.x + 5, r.y - cam.y + 5, r.w - 10, r.h - 10);
    }

    for (const b of bullets) {
      ctx.fillStyle = "#fff";
      if (b.beam) {
        ctx.fillRect((b.x >> 8) - cam.x - 4, (b.y >> 8) - cam.y - 4, 8, 8);
        ctx.fillStyle = "#0f380f";
        ctx.fillRect((b.x >> 8) - cam.x - 2, (b.y >> 8) - cam.y - 2, 4, 4);
        continue;
      }
      if (b.direct) { ctx.fillRect((b.x >> 8) - cam.x - 1, (b.y >> 8) - cam.y - 1, 2, 2); continue; }
      ctx.fillRect((b.x >> 8) - cam.x - 2, (b.y >> 8) - cam.y - 2, 4, 4);
    }

    // Limite de sprites: un sprite oculto un frame se muestra en el siguiente; si hay demasiados,
    // los mas lejanos al jugador pueden quedar ocultos hasta 2 frames seguidos.
    if (selFrame !== frame) {
      selFrame = frame;
      const live = players.filter((p) => p.active && p.hp > 0);
      const cand = [];
      for (const e of enemies) {
        const px = (e.x >> 8) - cam.x, py = (e.y >> 8) - cam.y;
        e.vis = false;
        if (px + e.size <= 0 || px >= GBC_W || py + e.size <= 0 || py >= VIEW_H) { e.hid = 0; continue; }
        let d = Infinity;
        for (const p of live) d = Math.min(d, ((p.x >> 8) - (e.x >> 8)) ** 2 + ((p.y >> 8) - (e.y >> 8)) ** 2);
        e.dist = d;
        cand.push(e);
      }
      const rank = (e) => (e.hid >= 2 ? 0 : e.hid === 1 ? 1 : 2);
      cand.sort((a, b) => rank(a) - rank(b) || a.dist - b.dist);
      const lineCount = new Map();
      let spriteCount = 0;
      for (const e of cand) {
        const py = (e.y >> 8) - cam.y;
        const cells = e.size >> 3;
        let ok = spriteCount + cells * cells <= CFG.maxSprites;
        for (let r = 0; r < cells && ok; r++) ok = (lineCount.get((py >> 3) + r) || 0) + cells <= CFG.maxSpritesPerLine;
        if (ok) {
          spriteCount += cells * cells;
          for (let r = 0; r < cells; r++) lineCount.set((py >> 3) + r, (lineCount.get((py >> 3) + r) || 0) + cells);
          e.vis = true;
          e.hid = 0;
        } else {
          e.hid = (e.hid || 0) + 1;
        }
      }
    }
    for (const e of enemies) {
      if (!e.vis) continue;
      const px = (e.x >> 8) - cam.x, py = (e.y >> 8) - cam.y;
      const frameIndex = e.moving ? ((e.animT / CFG.enemyAnimFrames) | 0) & 1 : 0;
      const img = assets[e.sprite];
      const src = e.type === "bee" ? img && [(((frame >> 1) + (e.id || 0)) & 1) * 8, 0] : [e.dir * e.size, frameIndex * e.size];
      const sw = e.type === "bee" ? 8 : e.size;
      ctx.drawImage(e.hit > 0 ? hitImages[e.sprite] || img : img, src[0], src[1], sw, sw, px, py, e.size, e.size);
    }
    drawHud(ctx);
    if (gameOver) drawGameOver(ctx);
    if (shop) drawShop(ctx);

    const status = players.map((p) => p.active ? `J${p.id + 1} HP ${p.hp} $ ${p.coins}` : `J${p.id + 1} -`).join("   ");
    document.getElementById("info").textContent = gameOver ? "GAME OVER - Arriba/Abajo elegir, Enter o disparo confirmar" :
      `${paused ? "PAUSA · " : ""}${status}   Oleada ${wave}   Enemigos ${enemies.length}`;
  }

  // ------------------------------------------------------------ Pantallas: splash y seleccion de personaje
  let screen = "splash";
  let menuSel = 0, rosterSel = 0, setSel = 0;
  const pick = { cur: [0, 1], ready: [false, false], joined: [true, false] };
  const STAT_BARS = [
    { label: "spd", key: "spd" },
    { label: "hp", key: "hp" },
    { label: "dmg", key: "dmg" },
  ];
  const CHAR_UI = [{ spd: 3, hp: 3, dmg: 3 }, { spd: 2, hp: 5, dmg: 5 }, { spd: 4, hp: 4, dmg: 4 }];

  const TXT = {
    es: { choose: "Elige personaje", pressA: "A elegir", ready: "Listo", spd: "Vel", hp: "Vida", dmg: "Dano", weapon: "Arma", special: "Especial",
      raiders: "Raiders", settings: "Ajustes", language: "Idioma", langName: "Espanol", sound: "Sonido", music: "Musica", sfx: "Efectos", back: "Volver",
      hintSplash: "Izq/Der elegir, F aceptar", hintSelect: "Izq/Der elegir, F confirmar, G cancelar; J2: pulsa , para unirte",
      hintRaiders: "Izq/Der elegir, F ver ficha, G volver", hintSheet: "Izq/Der cambiar personaje, G volver", hintSettings: "Arriba/Abajo elegir, Izq/Der cambiar, G volver" },
    en: { choose: "Choose character", pressA: "A choose", ready: "Ready", spd: "Speed", hp: "HP", dmg: "Damage", weapon: "Weapon", special: "Special",
      raiders: "Raiders", settings: "Settings", language: "Language", langName: "English", sound: "Sound", music: "Music", sfx: "Effects", back: "Back",
      hintSplash: "Left/Right choose, F accept", hintSelect: "Left/Right choose, F confirm, G cancel; P2: press , to join",
      hintRaiders: "Left/Right choose, F details, G back", hintSheet: "Left/Right change character, G back", hintSettings: "Up/Down choose, Left/Right change, G back" },
  };
  const tr = (k) => TXT[settings.lang ? "en" : "es"][k];
  const CHAR_INFO = [
    { es: { weapon: "Bazuca con explosion que dana a los enemigos cercanos.", special: "Area 3x3 con dano continuo." },
      en: { weapon: "Bazooka whose blast hurts nearby enemies.", special: "3x3 area with continuous damage." } },
    { es: { weapon: "Ametralladora, 15 balas por segundo con dispersion. Mucha vida, pero lento.", special: "Area 5x2 con dano x3 instantaneo." },
      en: { weapon: "Machine gun, 15 bullets per second with spread. Lots of HP, but slow.", special: "5x2 area with instant x3 damage." } },
    { es: { weapon: "Espada, 5 golpes por segundo, alcance de 2 tiles. Rapido y resistente.", special: "Proyectil que atraviesa y destruye todo." },
      en: { weapon: "Sword, 5 hits per second, 2 tile reach. Fast and sturdy.", special: "Projectile that pierces and destroys everything." } },
  ];
  const charName = (i) => CHARS[i].name[0] + CHARS[i].name.slice(1).toLowerCase();

  function openSelect() {
    screen = "select";
    pick.ready = [false, false];
    pick.joined = [true, false];
    pick.cur = [chars[0], chars[1]];
  }
  function openRaiders() { screen = "raiders"; }
  function openSettings() { screen = "settings"; setSel = 0; }

  function updateMenu() {
    rand16(); // la semilla depende del momento en que el jugador pulsa
    const pr0 = input.pressed[0], pr1 = input.pressed[1];
    const any = pr0 | pr1;
    const ok = any & (BTN.A | BTN.START), back = any & BTN.B;
    const dx = (any & BTN.RIGHT ? 1 : 0) - (any & BTN.LEFT ? 1 : 0);
    const dy = (any & BTN.DOWN ? 1 : 0) - (any & BTN.UP ? 1 : 0);
    if (screen === "splash") {
      if (dx) { menuSel = (menuSel + 3 + dx) % 3; sfx("hit"); }
      if (ok) { sfx("coin"); [openSelect, openRaiders, openSettings][menuSel](); }
      return;
    }
    if (screen === "raiders" || screen === "sheet") {
      if (dx) { rosterSel = (rosterSel + CHARS.length + dx) % CHARS.length; sfx("hit"); }
      if (screen === "raiders" && ok) { sfx("coin"); screen = "sheet"; }
      else if (back) screen = screen === "sheet" ? "raiders" : "splash";
      return;
    }
    if (screen === "settings") {
      const rows = 5;
      if (dy) { setSel = (setSel + rows + dy) % rows; sfx("hit"); }
      const key = ["lang", "master", "music", "sfx"][setSel];
      if (key && dx) {
        settings[key] = key === "lang" ? settings.lang ^ 1 : Math.min(5, Math.max(0, settings[key] + dx));
        saveSettings();
        sfx("coin");
      }
      if (back || (ok && setSel === rows - 1)) screen = "splash";
      return;
    }
    const pressedBy = [pr0, pr1];
    for (let i = 0; i < 2; i++) {
      const pr = pressedBy[i];
      if (!pick.joined[i]) {
        if (pr & (BTN.A | BTN.START | BTN.LEFT | BTN.RIGHT)) { pick.joined[i] = true; sfx("coin"); }
        continue;
      }
      if (!pick.ready[i]) {
        const n = CHARS.length;
        if (pr & BTN.LEFT) { pick.cur[i] = (pick.cur[i] + n - 1) % n; sfx("hit"); }
        if (pr & BTN.RIGHT) { pick.cur[i] = (pick.cur[i] + 1) % n; sfx("hit"); }
        if (pr & (BTN.A | BTN.START)) { pick.ready[i] = true; sfx("coin"); }
        else if (i === 0 && (pr & BTN.B)) screen = "splash";
      } else if (pr & BTN.B) {
        pick.ready[i] = false;
      } else if (i === 1 && (pr & BTN.SELECT)) {
        pick.joined[1] = false;
        pick.ready[1] = false;
      }
    }
    if (pick.ready[0] && (!pick.joined[1] || pick.ready[1])) {
      chars[0] = pick.cur[0];
      chars[1] = pick.joined[1] ? pick.cur[1] : (pick.cur[0] + 1) % CHARS.length;
      const p2 = pick.joined[1];
      screen = "game";
      resetGame();
      players[1].active = p2;
    }
  }

  function drawSplash(ctx) {
    const m = assets.splashMap;
    for (let i = 0; i < m.tiles.length; i++) {
      const t = m.tiles[i];
      ctx.drawImage(assets.splashTiles, (t % m.cols) * 8, ((t / m.cols) | 0) * 8, 8, 8, (i % m.w) * 8, ((i / m.w) | 0) * 8, 8, 8);
    }
    ["Play", "Raiders", "Settings"].forEach((label, i) => {
      const cx = 27 + i * 53;
      const sel = i === menuSel;
      ctx.globalAlpha = sel ? 1 : 0.55;
      drawTextCentered(ctx, label, 106, cx);
      ctx.globalAlpha = 1;
      if (sel && ((frame >> 4) & 1) === 0) {
        ctx.fillStyle = "#7a953a";
        ctx.fillRect(cx - 2, 100, 5, 1);
        ctx.fillRect(cx - 1, 101, 3, 1);
        ctx.fillRect(cx, 102, 1, 1);
        ctx.fillRect(cx - 2, 118, 5, 1);
        ctx.fillRect(cx - 1, 117, 3, 1);
        ctx.fillRect(cx, 116, 1, 1);
      }
    });
  }

  function drawBackdrop(ctx) {
    ctx.fillStyle = "#0f380f";
    ctx.fillRect(0, 0, GBC_W, GBC_H);
  }

  function drawBars(ctx, x, y, n, total = 5, w = 7, gap = 1) {
    for (let k = 0; k < total; k++) {
      ctx.fillStyle = k < n ? "#7a953a" : "#2a4e19";
      ctx.fillRect(x + k * (w + gap), y, w, 4);
    }
  }

  function drawPortraitFrame(ctx, i, bx, by, framed) {
    ctx.fillStyle = framed ? "#7a953a" : "#55742a";
    ctx.fillRect(bx, by, 44, 38);
    ctx.fillStyle = "#2a4e19";
    ctx.fillRect(bx + 2, by + 2, 40, 34);
    ctx.drawImage(assets.portraitsImage, i * 30, 0, 30, 30, bx + 7, by + 4, 30, 30);
  }

  function drawRoster(ctx) {
    drawBackdrop(ctx);
    drawTextCentered(ctx, tr("raiders"), 8);
    CHARS.forEach((c, i) => {
      const bx = 8 + i * 52;
      drawPortraitFrame(ctx, i, bx, 40, i === rosterSel);
      ctx.globalAlpha = i === rosterSel ? 1 : 0.55;
      drawTextCentered(ctx, charName(i), 82, bx + 22);
      ctx.globalAlpha = 1;
      if (i === rosterSel && ((frame >> 4) & 1) === 0) {
        ctx.fillStyle = "#7a953a";
        ctx.fillRect(bx + 19, 94, 5, 1);
        ctx.fillRect(bx + 20, 93, 3, 1);
        ctx.fillRect(bx + 21, 92, 1, 1);
      }
    });
  }

  function drawSheet(ctx) {
    drawBackdrop(ctx);
    const i = rosterSel, ui = CHAR_UI[i], info = CHAR_INFO[i][settings.lang ? "en" : "es"];
    ctx.fillStyle = "#7a953a";
    ctx.fillRect(6, 6, 64, 64);
    ctx.fillStyle = "#2a4e19";
    ctx.fillRect(8, 8, 60, 60);
    ctx.drawImage(assets.portraitsImage, i * 30, 0, 30, 30, 8, 8, 60, 60);
    drawText(ctx, charName(i), 78, 8);
    STAT_BARS.forEach((s, n) => {
      const y = 22 + n * 15;
      drawText(ctx, tr(s.label), 78, y);
      drawBars(ctx, 78, y + 9, ui[s.key], 5, 6, 1);
    });
    let y = 76;
    [["weapon", info.weapon], ["special", info.special]].forEach(([k, text]) => {
      drawText(ctx, tr(k), 8, y);
      ctx.fillStyle = "#55742a";
      ctx.fillRect(8, y + 8, 144, 1);
      wrapText(text, 144).slice(0, 3).forEach((line, n) => drawText(ctx, line, 8, y + 11 + n * 8));
      y += 38;
    });
  }

  function drawSettings(ctx) {
    drawBackdrop(ctx);
    drawTextCentered(ctx, tr("settings"), 8);
    const rows = [
      [tr("language")],
      [tr("sound"), 0, "master"],
      [tr("music"), 0, "music"],
      [tr("sfx"), 0, "sfx"],
      [tr("back")],
    ];
    rows.forEach(([label, , key], n) => {
      const y = 30 + n * 16;
      if (n === setSel) {
        ctx.fillStyle = "#7a953a";
        ctx.fillRect(10, y + 2, 4, 3);
        ctx.fillRect(14, y + 3, 1, 1);
      }
      ctx.globalAlpha = n === setSel ? 1 : 0.6;
      drawText(ctx, label, 20, y);
      if (n === 0) drawText(ctx, tr("langName"), 96, y);
      if (key) drawBars(ctx, 96, y + 2, settings[key], 5, 8, 2);
      ctx.globalAlpha = 1;
    });
  }

  function drawSelect(ctx) {
    drawBackdrop(ctx);
    const center = (str, y) => drawTextCentered(ctx, str, y);
    center(tr("choose"), 6);
    CHARS.forEach((c, i) => {
      const bx = 8 + i * 52;
      const by = 24;
      drawPortraitFrame(ctx, i, bx, by, false);
      drawTextCentered(ctx, charName(i), by + 41, bx + 22);
      for (let pi = 0; pi < 2; pi++) {
        if (!pick.joined[pi] || pick.cur[pi] !== i) continue;
        const mx = bx + (pi ? 28 : 4);
        const my = pi ? by + 60 : by - 6;
        const on = pick.ready[pi] || ((frame >> 4) & 1);
        ctx.fillStyle = on ? "#7a953a" : "#55742a";
        ctx.fillRect(mx, my, 12, 6);
        ctx.fillStyle = "#0f380f";
        drawTextTiny(ctx, String(pi + 1), mx + 3, my + 1);
        if (pick.ready[pi]) { ctx.strokeStyle = "#7a953a"; ctx.strokeRect(bx + 0.5, by + 0.5, 43, 37); }
      }
    });
    const ui = CHAR_UI[pick.cur[0]];
    STAT_BARS.forEach((s, i) => {
      const y = 100 + i * 9;
      drawText(ctx, tr(s.label), 8, y);
      drawBars(ctx, 48, y + 2, ui[s.key], 5, 8, 2);
    });
    if (((frame >> 4) & 1) && !pick.joined[1]) drawText(ctx, "J2 A", 112, 100);
    if (pick.ready[0] && ((frame >> 4) & 1)) center(tr("ready"), 128);
    else if (!pick.ready[0]) center(tr("pressA"), 128);
  }

  // Digito diminuto 3x5 para las etiquetas de jugador.
  function drawTextTiny(ctx, str, x, y) {
    const glyphs = { 1: ["010", "110", "010", "010", "111"], 2: ["110", "001", "010", "100", "111"] };
    const g = glyphs[str];
    if (!g) return;
    g.forEach((row, ry) => { for (let rx = 0; rx < 3; rx++) if (row[rx] === "1") ctx.fillRect(x + rx, y + ry, 1, 1); });
  }

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
})();
