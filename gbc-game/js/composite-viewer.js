"use strict";

(async () => {
  const status = document.getElementById("status");
  const container = document.getElementById("tiles");
  const number = document.getElementById("number");
  const biome = document.getElementById("biome");
  const kind = document.getElementById("kind");
  try {
    const [manifestResponse, imageResponse] = await Promise.all([
      fetch("maps/composite-tiles.json", { cache: "no-store" }),
      fetch("assets/composite-tiles.png", { cache: "no-store" })
    ]);
    if (!manifestResponse.ok || !imageResponse.ok)
      throw new Error(`HTTP ${manifestResponse.status} / ${imageResponse.status}`);
    const manifest = await manifestResponse.json();
    const atlas = await createImageBitmap(await imageResponse.blob(), { colorSpaceConversion: "none" });
    if (manifest.version !== 1 || manifest.tileSize !== 8 ||
        manifest.tiles.length !== manifest.count || atlas.width !== manifest.columns * 8 ||
        atlas.height !== Math.ceil(manifest.count / manifest.columns) * 8)
      throw new Error("El atlas y el catálogo no coinciden");

    function render() {
      const selected = manifest.tiles.filter(tile =>
        (!number.value || tile.id === Number(number.value)) &&
        (!biome.value || tile.recipe.biome === biome.value) &&
        (!kind.value || tile.recipe.kind === kind.value));
      const fragment = document.createDocumentFragment();
      for (const tile of selected) {
        const index = tile.id - 1;
        const card = document.createElement("div");
        card.className = "tile";
        card.title = `${tile.recipe.biome} / ${tile.recipe.kind}`;
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 8;
        canvas.setAttribute("aria-label", `Tile ${tile.id}`);
        canvas.getContext("2d").drawImage(atlas, (index % manifest.columns) * 8,
          Math.floor(index / manifest.columns) * 8, 8, 8, 0, 0, 8, 8);
        const label = document.createElement("strong");
        label.textContent = `#${tile.id}`;
        card.append(canvas, label);
        fragment.append(card);
      }
      container.replaceChildren(fragment);
      status.textContent = `${selected.length} de ${manifest.count} tiles`;
    }
    for (const input of [number, biome, kind]) input.addEventListener("input", render);
    render();
  } catch (error) {
    console.error("No se pudo cargar el catálogo de tiles:", error);
    status.textContent = `Error al cargar los tiles: ${error.message}. Usa el servidor local del juego.`;
  }
})();
