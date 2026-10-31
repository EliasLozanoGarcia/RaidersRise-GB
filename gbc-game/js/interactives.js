"use strict";
/* Objetos interactivos: pinchos, cofres, cristales, puertas, cajas de mana. */

// ------------------------------------------------------------ Objetos Interactivos
let spikes = [];
let manaBoxes = [];
const BARRIER_FIRST = 19, BARRIER_LAST = 24; // ids de las barreras destruibles (3 estados x 2 tiles)
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

  // Barreras destruibles: parejas VERTICALES (arriba impar / abajo par) que se rompen como un solo bloque,
  // con 3 estados de dano:  19/20 (entera) -> 21/22 (danada) -> 23/24 (muy danada) -> desaparece.
  // CFG.barrierHp = impactos necesarios para pasar de un estado al siguiente.
  if (t >= BARRIER_FIRST && t <= BARRIER_LAST) {
    const isTop = (t & 1) === 1;
    const partner = isTop ? idx + MAP_W : idx - MAP_W;               // celda de debajo / de encima
    const hasPartner = itemsLayer[partner] === (isTop ? t + 1 : t - 1); // misma pareja y mismo estado
    const top = isTop ? idx : (hasPartner ? partner : -1);
    const key = top >= 0 ? top : idx;                                // la hp se guarda en la celda de arriba
    const left = (barrierHp.get(key) ?? CFG.barrierHp) - 1;
    const cells = hasPartner ? [idx, partner] : [idx];
    if (left > 0) {
      barrierHp.set(key, left);
      for (const c of cells) barrierHit.set(c, CFG.hurtFlash);
    } else {
      barrierHp.delete(key);
      let destroyed = false;
      for (const c of cells) {
        const id = itemsLayer[c];
        if (id + 2 > BARRIER_LAST) { barrierHit.delete(c); setItemTile(c, -1); destroyed = true; } // ultimo estado: se destruye
        else { setItemTile(c, id + 2, itemsAttrs[c]); barrierHit.set(c, CFG.hurtFlash); }         // siguiente estado
      }
      // Si encima habia otra barrera (parte alta) cuya mitad de abajo estaba tapada por esta, la celda de arriba
      // del bloque destruido (pareja, o un 19 suelto) pasa a ser esa mitad de abajo (par), con el mismo
      // nivel de rotura que la de arriba. Si debajo de un 19 solo habia pared, no hay nada que revelar.
      const freed = hasPartner ? top : (isTop ? idx : -1);
      if (destroyed && freed >= 0) {
        const above = freed - MAP_W, aboveId = itemsLayer[above];
        if (aboveId >= BARRIER_FIRST && aboveId < BARRIER_LAST && (aboveId & 1) === 1) {
          setItemTile(freed, aboveId + 1, itemsAttrs[above]);
        }
      }
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

