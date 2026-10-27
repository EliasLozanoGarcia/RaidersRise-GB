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
        // El hardware no tiene flip diagonal: esas celdas se ignoran.
        if (raw & 0x20000000) {
          data.push(-1);
          attrs.push(0);
          continue;
        }
        const tileId = raw & 0x0fffffff;
        if (tileId > 255) throw new Error(`ID de tile ${tileId} fuera del tileset en ${url}`);
        data.push(tileId);
        attrs.push(
          ((raw & 0x80000000) ? 0x20 : 0) |
          ((raw & 0x40000000) ? 0x40 : 0)
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
      const [tilesetImage, playerImage, kurtImage, skreekImage, splashTiles, splashMap, enemyImage, beeImage, bigSlugImage, teleportImage,       backgroundMap, itemsMap, level1Fondo, level1Items, level1Logic, fontImage, portraitsImage] = await Promise.all([
        loadImage("assets/tileset_GBC_Urban.png"),
        loadImage("assets/Kathy_Sprites.png"),
        loadImage("assets/Kurt_Sprites.png"),
        loadImage("assets/Skreel_Sprites.png"),
        loadImage("assets/splash_tiles.png"),
        fetch("maps/splash.json").then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status} al cargar maps/splash.json`);
          return r.json();
        }),
        loadImage("assets/enemies_run.png"),
        loadImage("assets/enemies_Bee.png"),
        loadImage("assets/enemies_Slug_Big.png"),
        loadImage("assets/Teleport_GBC.png"),
        loadMapCSV("maps/Leveltest._Fondo.csv"),
        loadMapCSV("maps/Leveltest._Items.csv"),
        loadMapCSV("maps/Level1-1_Fondo.csv"),
        loadMapCSV("maps/Level1-1_Items.csv"),
        fetch("maps/Level1-1_Logic.json").then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status} al cargar maps/Level1-1_Logic.json`);
          return r.json();
        }),
        loadImage("assets/font_8x8.png"),
        loadImage("assets/portraits.png")
      ]);
      if (backgroundMap.w !== itemsMap.w || backgroundMap.h !== itemsMap.h
        || level1Fondo.w !== backgroundMap.w || level1Items.w !== backgroundMap.w
        || level1Fondo.h !== backgroundMap.h || level1Items.h !== backgroundMap.h) {
        throw new Error("Todas las capas de los niveles deben tener las mismas dimensiones");
      }
      return {
        tilesetImage,
        playerImage,
        kurtImage,
        skreekImage,
        splashTiles,
        splashMap,
        enemyImage,
        beeImage,
        bigSlugImage,
        teleportImage,
        backgroundMap,
        itemsMap,
        level1Fondo,
        level1Items,
        level1Logic,
        fontImage,
        portraitsImage
      };
    }
  };
})();
