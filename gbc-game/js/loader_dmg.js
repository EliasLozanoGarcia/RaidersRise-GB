window.DMGLoader = (function () {
  "use strict";

  async function loadMapCSV(url) {
    const response = await fetch(url);
    if (!response.ok) {
      const err = new Error(`HTTP ${response.status} al cargar ${url}`);
      err.notFound = response.status === 404;
      throw err;
    }

    const rows = (await response.text()).trim().split(/\r?\n/).map((line, rowIndex) => {
      const values = line.split(",").map((value) => {
        const parsed = Number(value.trim());
        if (!Number.isInteger(parsed)) throw new Error(`Valor no valido en ${url}, fila ${rowIndex + 1}`);
        return parsed;
      });
      return values;
    });
    // El tamano del mapa se deduce del propio CSV (ej. 20x16); todas las filas deben tener el mismo ancho.
    const w = rows[0].length, h = rows.length;
    rows.forEach((row, rowIndex) => {
      if (row.length !== w) throw new Error(`La fila ${rowIndex + 1} de ${url} tiene ${row.length} tiles; se esperaban ${w}`);
    });

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

    return { w, h, data, attrs };
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
      const [
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
        fontImage,
        portraitsImage,
        shotSmallImage,
        shotBigImage
      ] = await Promise.all([
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
        loadImage("assets/font_8x8.png"),
        loadImage("assets/portraits.png"),
        // Sprites de disparo: si faltan, el juego dibuja las balas como cuadrados (no es fatal).
        loadImage("assets/disparo_Small.png").catch(() => null), // Kurt
        loadImage("assets/disparo_Big.png").catch(() => null)    // Kathy
      ]);

      // Carga correlativa de todos los niveles Level1-1, Level1-2, Level1-3... que haya en maps/
      const levels = [];
      for (let i = 1; i <= 999; i++) {
        try {
          let fondo;
          try {
            fondo = await loadMapCSV(`maps/Level1-${i}_Fondo.csv`);
          } catch (e) {
            // Sin mas niveles: 404, o (segun el servidor) un fallo de red al pedir un archivo inexistente
            // ("Failed to fetch"). Solo si ya hay algun nivel cargado; si es el primero, es un error real.
            if (e.notFound || (e instanceof TypeError && levels.length > 0)) break;
            throw e;
          }
          const items = await loadMapCSV(`maps/Level1-${i}_Items.csv`);
          if (fondo.w !== items.w || fondo.h !== items.h) {
            throw new Error(`Dimensiones distintas en Level1-${i}: Fondo ${fondo.w}x${fondo.h}, Items ${items.w}x${items.h}`);
          }

          // Intenta cargar su archivo _Logic.json (si algún nivel no tiene, pone null y no falla)
          let logic = null;
          try {
            const logicRes = await fetch(`maps/Level1-${i}_Logic.json`);
            if (logicRes.ok) logic = await logicRes.json();
          } catch (err) {
            logic = null;
          }

          levels.push({
            w: fondo.w,
            h: fondo.h,
            fondo: fondo.data,
            fondoAttrs: fondo.attrs,
            items: items.data,
            itemsAttrs: items.attrs,
            logic: logic
          });
        } catch (e) {
          // Un nivel que existe pero esta mal formado ya no se ignora en silencio: se informa del motivo.
          throw new Error(`Level1-${i}: ${e.message}`);
        }
      }

      if (levels.length === 0) {
        throw new Error("No se encontró ningún nivel (ej: maps/Level1-1_Fondo.csv)");
      }

      // Mantenemos compatibilidad con las propiedades antiguas usando el primer nivel cargado
      const first = levels[0];
      const backgroundMap = { w: first.w, h: first.h, data: first.fondo, attrs: first.fondoAttrs };
      const itemsMap = { w: first.w, h: first.h, data: first.items, attrs: first.itemsAttrs };

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
        level1Fondo: backgroundMap,
        level1Items: itemsMap,
        level1Logic: first.logic,
        fontImage,
        portraitsImage,
        shotSmallImage,
        shotBigImage,
        levels
      };
    }
  };
})();