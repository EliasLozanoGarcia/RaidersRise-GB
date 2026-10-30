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

