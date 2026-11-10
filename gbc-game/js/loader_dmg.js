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
        desertTileset,
        snowTileset,
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
        selectionImage,
        profileImage,
        qrImage,
        shotSmallImage,
        shotBigImage,
        kurtDashImage
      ] = await Promise.all([
        loadImage("assets/tileset_GBC_Urban.png"),
        loadImage("assets/tileset_GBC_Desert.png"),
        loadImage("assets/tileset_GBC_Snow.png"),
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
        loadImage("assets/selection Screen.png"),
        loadImage("assets/riders Profile.png"),
        loadImage("assets/QR.png"),
        // Sprites de disparo: si faltan, el juego dibuja las balas como cuadrados (no es fatal).
        loadImage("assets/disparo_Small.png").catch(() => null), // Kurt
        loadImage("assets/disparo_Big.png").catch(() => null),   // Kathy
        loadImage("assets/Kurt-Dash_Sprite.png").catch((err) => { console.warn(err.message); return null; })
      ]);

      // Carga correlativa de todos los niveles Level0-N y Level1-N que haya en maps/
      const levels = [];
      for (const prefix of ["Level0", "Level1"]) {
        let familyLevels = 0;
        for (let i = 1; i <= 999; i++) {
          const mapName = `${prefix}-${i}`;
          let fondo;
          try {
            fondo = await loadMapCSV(`maps/${mapName}_Fondo.csv`);
          } catch (e) {
            // Un 404 termina esta familia; los fallos de red solo se tratan como fin si ya cargamos mapas de ella.
            if (e.notFound || (e instanceof TypeError && (familyLevels > 0 || prefix === "Level0"))) break;
            throw e;
          }

          try {
            const items = await loadMapCSV(`maps/${mapName}_Items.csv`);
            if (fondo.w !== items.w || fondo.h !== items.h) {
              throw new Error(`Dimensiones distintas: Fondo ${fondo.w}x${fondo.h}, Items ${items.w}x${items.h}`);
            }

            // Intenta cargar su archivo _Logic.json (si algún nivel no tiene, pone null y no falla)
            let logic = null;
            try {
              const logicRes = await fetch(`maps/${mapName}_Logic.json`);
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
            familyLevels++;
          } catch (e) {
            // Un nivel que existe pero está mal formado ya no se ignora en silencio: se informa del motivo.
            throw new Error(`${mapName}: ${e.message}`);
          }
        }
      }

      if (levels.length === 0) {
        throw new Error("No se encontró ningún nivel (ej: maps/Level0-1_Fondo.csv o maps/Level1-1_Fondo.csv)");
      }

      return {
        tilesetImage,
        biomeTilesets: [tilesetImage, desertTileset, snowTileset],
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
        selectionImage,
        profileImage,
        qrImage,
        shotSmallImage,
        shotBigImage,
        kurtDashImage,
        levels
      };
    }
  };
})();