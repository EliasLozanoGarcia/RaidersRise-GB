window.DMGLoader = (function () {
  "use strict";

  const DMG_PALETTE_15BIT = [
    19 | (23 << 5) | (2 << 10),
    17 | (21 << 5) | (2 << 10),
    6 | (12 << 5) | (6 << 10),
    2 | (7 << 5) | (2 << 10)
  ];

  async function loadMapCSV(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status} al cargar ${url}`);

    const rows = (await response.text()).trim().split(/\r?\n/).map((line, rowIndex) => {
      const values = line.split(",").map((value) => {
        const parsed = Number(value.trim());
        if (!Number.isInteger(parsed)) throw new Error(`Valor no valido en ${url}, fila ${rowIndex + 1}`);
        return parsed;
      });
      if (values.length !== 32) throw new Error(`La fila ${rowIndex + 1} de ${url} tiene ${values.length} tiles; se esperaban 32`);
      return values;
    });
    if (rows.length !== 32) throw new Error(`${url} tiene ${rows.length} filas; se esperaban 32`);

    const data = [];
    const attrs = [];
    for (const row of rows) {
      for (const value of row) {
        if (value === -1) {
          data.push(-1);
          attrs.push(0);
          continue;
        }

        const raw = value >>> 0;
        const tileId = raw & 0x0fffffff;
        if (tileId > 255) throw new Error(`ID de tile ${tileId} fuera del tileset en ${url}`);
        data.push(tileId);
        attrs.push(
          ((raw & 0x80000000) ? 0x20 : 0) |
          ((raw & 0x40000000) ? 0x40 : 0) |
          ((raw & 0x20000000) ? 0x10 : 0)
        );
      }
    }

    return { w: 32, h: 32, data, attrs };
  }

  function loadTilesetDMG(imageSrc) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try {
          if (img.width % 8 || img.height % 8) {
            throw new Error(`${imageSrc} debe medir multiplos de 8 px`);
          }
          const canvas = document.createElement("canvas");
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          ctx.drawImage(img, 0, 0);

          const tilesWide = img.width / 8;
          const tilesHigh = img.height / 8;
          const tiles = [];
          for (let tile = 0; tile < tilesWide * tilesHigh; tile++) {
            const tx = (tile % tilesWide) * 8;
            const ty = Math.floor(tile / tilesWide) * 8;
            const pixels = ctx.getImageData(tx, ty, 8, 8).data;
            const bytes = new Uint8Array(16);

            for (let y = 0; y < 8; y++) {
              let low = 0, high = 0;
              for (let x = 0; x < 8; x++) {
                const offset = (y * 8 + x) * 4;
                const alpha = pixels[offset + 3];
                const luminance = 0.299 * pixels[offset] + 0.587 * pixels[offset + 1] + 0.114 * pixels[offset + 2];
                const color = alpha <= 64 ? 0 : luminance > 185 ? 0 : luminance > 125 ? 1 : luminance > 65 ? 2 : 3;
                low = (low << 1) | (color & 1);
                high = (high << 1) | ((color >> 1) & 1);
              }
              bytes[y * 2] = low;
              bytes[y * 2 + 1] = high;
            }
            tiles.push(bytes);
          }
          resolve({ tiles, tilesWide, tilesHigh });
        } catch (error) {
          reject(error);
        }
      };
      img.onerror = () => reject(new Error(`No se pudo cargar la imagen ${imageSrc}`));
      img.src = imageSrc;
    });
  }

  return {
    init: async function () {
      const [tileset, player, enemy, backgroundMap, itemsMap] = await Promise.all([
        loadTilesetDMG("assets/tileset_Urban.png"),
        loadTilesetDMG("assets/Kathy_Run.png"),
        loadTilesetDMG("assets/enemies_run.png"),
        loadMapCSV("maps/Leveltest._Fondo.csv"),
        loadMapCSV("maps/Leveltest._Items.csv")
      ]);
      if (backgroundMap.w !== itemsMap.w || backgroundMap.h !== itemsMap.h) {
        throw new Error("Las capas Fondo e Items deben tener las mismas dimensiones");
      }
      return {
        palette: DMG_PALETTE_15BIT,
        tiles: tileset.tiles,
        playerTiles: player.tiles,
        playerTilesWide: player.tilesWide,
        playerTilesHigh: player.tilesHigh,
        enemyTiles: enemy.tiles,
        enemyTilesWide: enemy.tilesWide,
        enemyTilesHigh: enemy.tilesHigh,
        backgroundMap,
        itemsMap
      };
    }
  };
})();
