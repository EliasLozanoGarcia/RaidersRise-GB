"use strict";
/* Movimiento con colisiones (tryMove, nudge, findFree...). */

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

// Posicion libre mas cercana (resolucion de 1 px) para una caja atrapada: dentro de un tile solido o fuera de la
// zona jugable (mapa / camara). Devuelve [x, y], o null si no hay hueco en maxR pixeles.
function nearestFree(x, y, box, limitToCam, maxR = 64) {
  const ok = (px, py) => !boxBlocked(px, py, box, false, limitToCam);
  if (ok(x, y)) return [x, y];
  for (let r = 1; r <= maxR; r++) {
    let best = null, bestD = Infinity;
    for (let oy = -r; oy <= r; oy++) {
      for (let ox = -r; ox <= r; ox++) {
        if (Math.max(Math.abs(ox), Math.abs(oy)) !== r) continue;
        const d = ox * ox + oy * oy;
        if (d < bestD && ok(x + ox, y + oy)) { best = [x + ox, y + oy]; bestD = d; }
      }
    }
    if (best) return best;
  }
  return null;
}

// Saca a un jugador atrapado. snap = true: lo coloca al instante; si no, lo empuja 1 px por frame hacia el hueco.
function unstickPlayer(p, snap) {
  const px = p.x >> 8, py = p.y >> 8;
  if (!boxBlocked(px, py, PBOX, false, true)) return false;
  const f = nearestFree(px, py, PBOX, true);
  if (!f) return false;
  if (snap) { p.x = f[0] << 8; p.y = f[1] << 8; }
  else { p.x += Math.sign(f[0] - px) * 256; p.y += Math.sign(f[1] - py) * 256; }
  return true;
}

// Colision de una bala con muros (en el suelo: gy). Es permisiva en los bordes: ademas del punto central, tienen que
// estar bloqueados los dos puntos a +-CFG.bulletEdgeSlack px en perpendicular a su trayectoria. Si solo roza una
// esquina o el borde de un tile, el punto lateral esta libre y la bala sigue.
function bulletBlocked(b, bx, gy) {
  if (!boxBlocked(bx, gy, BBOX, true, false)) return false;
  const e = CFG.bulletEdgeSlack;
  if (!e) return true;
  const ax = Math.abs(b.vx), ay = Math.abs(b.vy);
  const sx = ax * 2 >= ay ? Math.sign(b.vx) : 0;
  const sy = ay * 2 >= ax ? Math.sign(b.vy) : 0;
  const px = -sy * e, py = sx * e; // perpendicular a la trayectoria
  return boxBlocked(bx + px, gy + py, BBOX, true, false) && boxBlocked(bx - px, gy - py, BBOX, true, false);
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

