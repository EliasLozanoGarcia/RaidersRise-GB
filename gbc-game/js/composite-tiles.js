"use strict";

window.CompositeTiles = (() => {
  const missing = new Set();
  const placeholder = new Uint8Array([0x55, 0x55, 0xaa, 0xaa, 0x55, 0x55, 0xaa, 0xaa,
    0x55, 0x55, 0xaa, 0xaa, 0x55, 0x55, 0xaa, 0xaa]);
  const status = document.getElementById("composite-missing");
  let lookup = null, bytes = null, atlas = null, columns = 0, count = 0;

  async function read(url) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
    return response.arrayBuffer();
  }

  async function hash(data) {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
    return Array.from(digest, value => value.toString(16).padStart(2, "0")).join("");
  }

  async function load() {
    const manifestBytes = await read("maps/composite-tiles.json");
    const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
    if (manifest.version !== 1 || manifest.tileSize !== 8 || !Number.isInteger(manifest.columns) ||
        manifest.columns < 1 || !Number.isInteger(manifest.uniqueCount) || manifest.uniqueCount < 1 ||
        !Array.isArray(manifest.tiles) || manifest.tiles.length !== manifest.count || !manifest.sourceSha256)
      throw new Error("Catálogo de tiles compuestos no válido; vuelve a generarlo");
    const sources = {
      urban: "assets/tileset_GBC_Urban.png",
      desert: "assets/tileset_GBC_Desert.png",
      snow: "assets/tileset_GBC_Snow.png",
      "urban-transparent": "assets/tileset_GBC_Urban_Transparente.png"
    };
    const names = Object.keys(sources);
    const urls = ["assets/composite-unique.2bpp", "assets/composite-unique.png",
      ...names.map(name => sources[name])];
    const data = await Promise.all(urls.map(read));
    if (data[0].byteLength !== manifest.uniqueCount * 16 ||
        await hash(data[0]) !== manifest.uniqueSha256 || await hash(data[1]) !== manifest.atlasSha256)
      throw new Error("Los tiles compuestos no coinciden con el catálogo; vuelve a generarlos");
    for (let i = 0; i < names.length; i++) {
      if (await hash(data[i + 2]) !== manifest.sourceSha256[names[i]])
        throw new Error(`El tileset ${names[i]} ha cambiado; vuelve a generar los tiles compuestos`);
    }
    const next = new Map();
    for (const tile of manifest.tiles) {
      if (!Number.isInteger(tile.unique) || tile.unique < 0 || tile.unique >= manifest.uniqueCount ||
          ![0, 32, 64, 96].includes(tile.flip) || !tile.recipe)
        throw new Error("Entrada no válida en el catálogo de tiles compuestos");
      const key = JSON.stringify(tile.recipe);
      if (next.has(key)) throw new Error("Receta duplicada en el catálogo de tiles compuestos");
      next.set(key, { index: tile.unique, flip: tile.flip });
    }
    const image = await createImageBitmap(new Blob([data[1]], { type: "image/png" }),
      { colorSpaceConversion: "none" });
    if (image.width !== manifest.columns * 8 ||
        image.height !== Math.ceil((manifest.uniqueCount + 1) / manifest.columns) * 8)
      throw new Error("Atlas de tiles compuestos no válido");
    bytes = new Uint8Array(data[0]);
    atlas = image;
    columns = manifest.columns;
    count = manifest.uniqueCount;
    lookup = next;
  }

  function resolve(recipe) {
    if (!lookup) throw new Error("Los tiles compuestos no se han cargado");
    const key = JSON.stringify(recipe);
    const entry = lookup.get(key);
    if (entry) return { index: entry.index, flip: entry.flip, bytes: bytes.subarray(entry.index * 16, entry.index * 16 + 16) };
    if (!missing.has(key)) {
      missing.add(key);
      if (window.CompositeRecorder) window.CompositeRecorder.record(recipe);
      if (status) status.textContent = `Tiles nuevos sin generar: ${missing.size}. Se muestran con un patrón de cuadros.`;
    }
    return { index: count, flip: 0, bytes: placeholder };
  }

  function draw(ctx, tile, x, y) {
    ctx.save();
    ctx.translate(x + 4, y + 4);
    if (tile.flip & 32) ctx.scale(-1, 1);
    if (tile.flip & 64) ctx.scale(1, -1);
    ctx.drawImage(atlas, (tile.index % columns) * 8, Math.floor(tile.index / columns) * 8,
      8, 8, -4, -4, 8, 8);
    ctx.restore();
  }

  return { load, resolve, draw };
})();
