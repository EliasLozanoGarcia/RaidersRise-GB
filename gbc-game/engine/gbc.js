/*
 * Mini-PPU de Game Boy Color (solo la parte grafica).
 *
 * Reproduce las limitaciones del hardware:
 *   - Pantalla 160x144
 *   - 2 bancos de VRAM de tiles 8x8 a 2 bits por pixel (formato de 16 bytes)
 *   - Fondo 32x32 tiles con atributos (paleta 0-7, banco, flip H/V, prioridad)
 *   - Capa Window (mapa propio, posicion WX/WY)
 *   - OAM de 40 sprites, 8x8 u 8x16, maximo 10 por linea de escaneo
 *   - 8 paletas de fondo + 8 de sprites, 4 colores RGB555 cada una
 *     (el color 0 de sprite es transparente)
 *   - Se renderiza LINEA A LINEA y se llama a onScanline(ly) antes de cada
 *     linea, asi puedes cambiar SCX/SCY/paletas a mitad de pantalla
 *     (efectos tipo HBlank) igual que en la consola real.
 */
(function () {
  "use strict";
  const W = 160, H = 144;

  // Tablas RGB555 -> pixel ABGR (little endian) crudas y con correccion tipo LCD GBC
  const lutRaw = new Uint32Array(32768);
  const lutLcd = new Uint32Array(32768);
  for (let c = 0; c < 32768; c++) {
    const r = c & 31, g = (c >> 5) & 31, b = (c >> 10) & 31;
    const r8 = (r << 3) | (r >> 2), g8 = (g << 3) | (g >> 2), b8 = (b << 3) | (b >> 2);
    lutRaw[c] = (0xff000000 | (b8 << 16) | (g8 << 8) | r8) >>> 0;
    const R = Math.min(255, (r * 13 + g * 2 + b) >> 1);
    const G = Math.min(255, (g * 3 + b) << 1);
    const B = Math.min(255, (r * 3 + g * 2 + b * 11) >> 1);
    lutLcd[c] = (0xff000000 | (B << 16) | (G << 8) | R) >>> 0;
  }

  class GBC {
    constructor(canvas) {
      this.canvas = canvas;
      canvas.width = W;
      canvas.height = H;
      this.ctx = canvas.getContext("2d");
      this.image = this.ctx.createImageData(W, H);
      this.fb = new Uint32Array(this.image.data.buffer);

      // VRAM: dos bancos, los tiles empiezan en 0x8000 (id 0-255 * 16 bytes)
      this.vram = [new Uint8Array(256 * 16), new Uint8Array(256 * 16)];
      // Mapas: 0 = fondo, 1 = window. Un mapa de ids (banco 0) y uno de atributos (banco 1)
      this.mapTile = [new Uint8Array(1024), new Uint8Array(1024)];
      this.mapAttr = [new Uint8Array(1024), new Uint8Array(1024)];
      // OAM: 40 x (y, x, tile, attr)
      this.oam = new Uint8Array(160);
      // Paletas RGB555
      this.bgPal = new Uint16Array(32);
      this.objPal = new Uint16Array(32);

      // Registros
      this.scx = 0;
      this.scy = 0;
      this.wx = 7;
      this.wy = 144;
      this.lcdc = { bgPriority: true, objOn: true, obj16: false, winOn: false };
      this.lcdCorrection = false;
      this.onScanline = null;

      // Estadisticas de la ultima frame
      this.stats = { oamUsed: 0, maxLine: 0, lostSprites: 0, linesOver: 0 };

      this._bgIdx = new Uint8Array(W);
      this._bgPrio = new Uint8Array(W);
      this._sel = new Int16Array(10);
    }

    // ---- helpers de carga
    loadTiles(bank, firstId, tiles) {
      for (let i = 0; i < tiles.length; i++) this.vram[bank].set(tiles[i], (firstId + i) * 16);
    }
    setBgPalette(n, colors) { for (let i = 0; i < 4; i++) this.bgPal[n * 4 + i] = colors[i]; }
    setObjPalette(n, colors) { for (let i = 0; i < 4; i++) this.objPal[n * 4 + i] = colors[i]; }

    clearOam() { this.oam.fill(0); }
    setSprite(i, x, y, tile, attr) {
      // x,y = posicion en pantalla del pixel superior izquierdo (se aplica el desplazamiento de OAM)
      const o = i * 4;
      this.oam[o] = (y + 16) & 255;
      this.oam[o + 1] = (x + 8) & 255;
      this.oam[o + 2] = tile;
      this.oam[o + 3] = attr;
    }

    // ---- render
    renderFrame() {
      const st = this.stats;
      st.oamUsed = 0; st.maxLine = 0; st.lostSprites = 0; st.linesOver = 0;
      for (let i = 0; i < 40; i++) if (this.oam[i * 4] !== 0) st.oamUsed++;
      this._winLine = 0;
      for (let ly = 0; ly < H; ly++) {
        if (this.onScanline) this.onScanline(ly, this);
        this._renderLine(ly);
      }
      this.ctx.putImageData(this.image, 0, 0);
    }

    _renderLine(ly) {
      const fb = this.fb, off = ly * W;
      const lut = this.lcdCorrection ? lutLcd : lutRaw;
      const bgIdx = this._bgIdx, bgPrio = this._bgPrio;
      const bgPal = this.bgPal;
      const winActive = this.lcdc.winOn && ly >= this.wy && this.wx <= 166;
      const winX0 = this.wx - 7;
      let usedWin = false;

      for (let x = 0; x < W; x++) {
        let map, px, py;
        if (winActive && x >= winX0) {
          map = 1; px = x - winX0; py = this._winLine; usedWin = true;
        } else {
          map = 0; px = (x + this.scx) & 255; py = (ly + this.scy) & 255;
        }
        const mi = (py >> 3) * 32 + (px >> 3);
        const tid = this.mapTile[map][mi];
        const attr = this.mapAttr[map][mi];
        let yy = py & 7, xx = px & 7;
        if (attr & 0x10) [xx, yy] = [yy, xx];
        if (attr & 0x40) yy = 7 - yy;
        if (attr & 0x20) xx = 7 - xx;
        const base = tid * 16 + yy * 2;
        const v = this.vram[(attr >> 3) & 1];
        const bit = 7 - xx;
        const ci = (((v[base + 1] >> bit) & 1) << 1) | ((v[base] >> bit) & 1);
        bgIdx[x] = ci;
        bgPrio[x] = (attr & 0x80) ? 1 : 0;
        fb[off + x] = lut[bgPal[(attr & 7) * 4 + ci]];
      }
      if (usedWin) this._winLine++;

      if (!this.lcdc.objOn) return;

      // Busqueda OAM: primeros 10 sprites (por orden de OAM) que tocan esta linea.
      // El hardware cuenta el sprite aunque este fuera de pantalla en X.
      const h = this.lcdc.obj16 ? 16 : 8;
      const sel = this._sel;
      let n = 0, over = 0;
      const oam = this.oam;
      for (let i = 0; i < 40; i++) {
        const sy = oam[i * 4] - 16;
        if (ly >= sy && ly < sy + h) {
          if (n < 10) sel[n++] = i; else over++;
        }
      }
      if (n > this.stats.maxLine) this.stats.maxLine = n;
      if (over) { this.stats.lostSprites += over; this.stats.linesOver++; }

      const objPal = this.objPal;
      // En GBC gana el sprite de menor indice OAM: se dibuja del ultimo al primero.
      for (let k = n - 1; k >= 0; k--) {
        const i = sel[k], o = i * 4;
        const sx = oam[o + 1] - 8;
        if (sx <= -8 || sx >= W) continue;
        let tile = oam[o + 2];
        const attr = oam[o + 3];
        let row = ly - (oam[o] - 16);
        if (attr & 0x40) row = h - 1 - row;
        if (this.lcdc.obj16) { tile = (tile & 0xfe) + (row >= 8 ? 1 : 0); row &= 7; }
        const v = this.vram[(attr >> 3) & 1];
        const base = tile * 16 + row * 2;
        const lo = v[base], hi = v[base + 1];
        const pal = (attr & 7) * 4;
        for (let p = 0; p < 8; p++) {
          const x = sx + p;
          if (x < 0 || x >= W) continue;
          const bit = (attr & 0x20) ? p : 7 - p;
          const ci = (((hi >> bit) & 1) << 1) | ((lo >> bit) & 1);
          if (ci === 0) continue;
          if (this.lcdc.bgPriority && bgIdx[x] !== 0 && ((attr & 0x80) || bgPrio[x])) continue;
          fb[off + x] = lut[objPal[pal + ci]];
        }
      }
    }
  }

  window.GBC = GBC;
  window.GBC_W = W;
  window.GBC_H = H;
})();
