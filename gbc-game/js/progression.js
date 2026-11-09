"use strict";

const isCrystalLevel = (n) => n % 3 === 0;
const biomeIndex = (n) => Math.floor((n - 1) / 10) % 3;
const wavesPerPoint = (n) => 1 + Math.floor(n / 3);
const aggressionMultiplier = (n) => n < 3 ? 256 : n < 6 ? 320 : n < 9 ? 384 : 512;
