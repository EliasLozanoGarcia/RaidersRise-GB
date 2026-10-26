window.DMGLoader = (function () {
  "use strict";

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

  function loadImage(imageSrc) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`No se pudo cargar la imagen ${imageSrc}`));
      img.src = imageSrc;
    });
  }

  return {
    init: async function () {
      const [tilesetImage, playerImage, enemyImage, teleportImage, backgroundMap, itemsMap] = await Promise.all([
        loadImage("assets/tileset_GBC_Urban.png"),
        loadImage("assets/Kathy_Sprites.png"),
        loadImage("assets/enemies_run.png"),
        loadImage("assets/Teleport_GBC.png"),
        loadMapCSV("maps/Leveltest._Fondo.csv"),
        loadMapCSV("maps/Leveltest._Items.csv")
      ]);
      if (backgroundMap.w !== itemsMap.w || backgroundMap.h !== itemsMap.h) {
        throw new Error("Las capas Fondo e Items deben tener las mismas dimensiones");
      }
      return {
        tilesetImage,
        playerImage,
        enemyImage,
        teleportImage,
        backgroundMap,
        itemsMap
      };
    }
  };
})();
