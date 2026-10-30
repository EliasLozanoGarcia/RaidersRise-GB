"use strict";
/* Personajes, mejoras y tienda. */

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

