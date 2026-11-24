"""Genera un atlas y tiles GBC numerados a partir de las recetas observadas."""

import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OBSERVATIONS = ROOT / "composite-observations.json"
REQUIRED = ROOT / "composite-required.json"
MANIFEST = ROOT / "maps" / "composite-tiles.json"
ATLAS = ROOT / "assets" / "composite-tiles.png"
BINARY = ROOT / "assets" / "composite-tiles.2bpp"
UNIQUE_ATLAS = ROOT / "assets" / "composite-unique.png"
UNIQUE_BINARY = ROOT / "assets" / "composite-unique.2bpp"
COLS = 32
PALETTE = ((122, 149, 58), (85, 116, 42), (42, 78, 25), (15, 56, 15))
FLOOR_TILES = (64, 65, 66, 67, 69, 70, 71, 72)
URBAN_FLOOR_TILES = (70, 71, 72)
BIOMES = ("urban", "desert", "snow")
ASSET_PATHS = {
    name: ROOT / "assets" / f"tileset_GBC_{name.title()}.png" for name in BIOMES
}
ASSET_PATHS["urban-transparent"] = ROOT / "assets" / "tileset_GBC_Urban_Transparente.png"


def image_tile(image, tile):
    x, y = (tile % 32) * 8, (tile // 32) * 8
    return image.crop((x, y, x + 8, y + 8))


def transparent_floor(image, tiles):
    result = image.copy()
    pixels = result.load()
    floor = pixels[(49 % 32) * 8, (49 // 32) * 8]
    for tile in tiles:
        x0, y0 = (tile % 32) * 8, (tile // 32) * 8
        for y in range(y0, y0 + 8):
            for x in range(x0, x0 + 8):
                if pixels[x, y] == floor:
                    pixels[x, y] = (*floor[:3], 0)
    return result


def remap(image, mapping):
    result = image.copy()
    pixels = result.load()
    for y in range(result.height):
        for x in range(result.width):
            pixel = pixels[x, y]
            if pixel[3] and pixel[:3] in mapping:
                pixels[x, y] = (*mapping[pixel[:3]], pixel[3])
    return result


def hit_image(image):
    ramp = tuple(reversed(PALETTE))
    return remap(image, {color: ramp[min(i + 1, 3)] for i, color in enumerate(ramp)})


def lucky_hit_image(image):
    colors = set()
    for tile in (27, 28, 59, 60):
        colors.update(pixel[:3] for pixel in image_tile(image, tile).getdata() if pixel[3])
    colors = sorted(colors, key=lambda color: 299 * color[0] + 587 * color[1] + 114 * color[2])
    if len(colors) != 4:
        raise ValueError(f"La paleta de lucky blocks debe tener 4 colores, no {len(colors)}")
    return remap(image, {color: colors[min(i + 1, 3)] for i, color in enumerate(colors)})


def load_sources():
    images = {}
    for name, file in ASSET_PATHS.items():
        with Image.open(file) as original:
            image = original.convert("RGBA")
        if image.size != (256, 64):
            raise ValueError(f"{file.name}: dimensiones {image.size}, se esperaban 256x64")
        alphas = set(image.getchannel("A").getextrema())
        if not alphas.issubset({0, 255}) or image.getchannel("A").histogram()[1:255] != [0] * 254:
            raise ValueError(f"{file.name}: no se admite transparencia parcial")
        images[name] = image
    pickups = Image.new("RGBA", (256, 64))
    for dest, source, tile in (
        (152, "urban-transparent", 152), (153, "urban-transparent", 153), (154, "urban-transparent", 154),
        (155, "urban-transparent", 155), (160, "desert", 150), (161, "desert", 151),
        (162, "desert", 152),
    ):
        pickups.paste(image_tile(images[source], tile), ((dest % 32) * 8, (dest // 32) * 8))
    images["pickups"] = pickups
    images["pickups-hit"] = hit_image(pickups)
    images["urban-transparent-hit"] = hit_image(images["urban-transparent"])
    for biome in BIOMES:
        base = images[biome]
        transparent = transparent_floor(base, URBAN_FLOOR_TILES if biome == "urban" else FLOOR_TILES)
        images[f"{biome}:biome-transparent"] = transparent
        images[f"{biome}:biome-hit"] = hit_image(base)
        images[f"{biome}:biome-transparent-hit"] = hit_image(transparent)
    return images


def recipe_key(recipe):
    return json.dumps(recipe, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def validate_recipe(recipe):
    if set(recipe) != {"biome", "kind", "layers"} or recipe["biome"] not in BIOMES:
        raise ValueError(f"Receta no valida: {recipe!r}")
    if recipe["kind"] not in ("normal", "special", "special-fallback"):
        raise ValueError(f"Tipo de receta no valido: {recipe['kind']!r}")
    layers = recipe["layers"]
    if not isinstance(layers, list) or not 1 <= len(layers) <= 8:
        raise ValueError("Numero de capas no valido")
    for layer in layers:
        if set(layer) != {"source", "tile", "attr", "x", "y"}:
            raise ValueError(f"Capa no valida: {layer!r}")
        if (type(layer["tile"]) is not int or not 0 <= layer["tile"] <= 255 or
                type(layer["attr"]) is not int or layer["attr"] not in (0, 32, 64, 96) or
                type(layer["x"]) is not int or not -8 <= layer["x"] <= 8 or
                type(layer["y"]) is not int or not -8 <= layer["y"] <= 8):
            raise ValueError(f"Coordenadas o atributos no validos: {layer!r}")


def compose(recipe, images):
    result = Image.new("RGBA", (8, 8))
    for index, layer in enumerate(recipe["layers"]):
        source = layer["source"]
        alert = (index > 0 and layer["tile"] == 93 and
                 recipe["layers"][index - 1]["tile"] in (29, 30, 31))
        if index > 0 and source == "urban" and (recipe["biome"] != "urban" or alert):
            source = "urban-transparent"
        elif alert and source == "biome-hit" and recipe["biome"] == "urban":
            source = "urban-transparent-hit"
        if source.startswith("biome-"):
            source = f"{recipe['biome']}:{source}"
        if source.endswith(":biome-lucky-hit") and source not in images:
            images[source] = lucky_hit_image(images[recipe["biome"]])
        if source not in images:
            raise ValueError(f"Fuente desconocida: {source}")
        tile = image_tile(images[source], layer["tile"])
        if layer["attr"] & 32:
            tile = tile.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
        if layer["attr"] & 64:
            tile = tile.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
        result.alpha_composite(tile, (layer["x"], layer["y"]))
    return result


def encode_tile(image):
    pixels = image.load()
    encoded = bytearray()
    preview = Image.new("RGB", (8, 8))
    preview_pixels = preview.load()
    for y in range(8):
        lo = hi = 0
        for x in range(8):
            pixel = pixels[x, y]
            index = 0 if pixel[3] < 64 else min(
                range(4), key=lambda i: sum((pixel[n] - PALETTE[i][n]) ** 2 for n in range(3)))
            lo |= (index & 1) << (7 - x)
            hi |= ((index >> 1) & 1) << (7 - x)
            preview_pixels[x, y] = PALETTE[index]
        encoded.extend((lo, hi))
    return encoded, preview


def flip_tile(data, horizontal, vertical):
    def reverse(value):
        return int(f"{value:08b}"[::-1], 2)

    output = bytearray()
    for y in range(8):
        row = 7 - y if vertical else y
        for value in data[row * 2:row * 2 + 2]:
            output.append(reverse(value) if horizontal else value)
    return bytes(output)


def main(additional_observations=()):
    observed = json.loads(OBSERVATIONS.read_text(encoding="utf-8"))
    if observed.get("version") != 1 or not isinstance(observed.get("combinations"), list):
        raise ValueError("Registro de observaciones no valido")
    recipes = []
    seen = set()
    if MANIFEST.exists():
        previous = json.loads(MANIFEST.read_text(encoding="utf-8"))
        if previous.get("version") != 1 or not isinstance(previous.get("tiles"), list):
            raise ValueError("Manifest anterior no valido")
        for i, tile in enumerate(previous["tiles"], 1):
            if tile.get("id") != i:
                raise ValueError("La numeracion anterior no es consecutiva")
            recipe = tile["recipe"]
            validate_recipe(recipe)
            key = recipe_key(recipe)
            if key in seen:
                raise ValueError("Receta duplicada en el manifest anterior")
            seen.add(key)
            recipes.append(recipe)
    for data in (observed, *(json.loads(path.read_text(encoding="utf-8")) for path in additional_observations)):
        if data.get("version") != 1 or not isinstance(data.get("combinations"), list):
            raise ValueError("Registro de observaciones adicional no valido")
        for recipe in data["combinations"]:
            validate_recipe(recipe)
            key = recipe_key(recipe)
            if key not in seen:
                seen.add(key)
                recipes.append(recipe)
    required = json.loads(REQUIRED.read_text(encoding="utf-8"))
    if required.get("version") != 1 or not isinstance(required.get("combinations"), list):
        raise ValueError("Lista de combinaciones solicitadas no valida")
    for combination in required["combinations"]:
        if (set(combination) != {"biome", "floor", "item"} or combination["biome"] not in BIOMES or
                type(combination["floor"]) is not int or not 0 <= combination["floor"] <= 255 or
                type(combination["item"]) is not int or not 0 <= combination["item"] <= 255):
            raise ValueError(f"Combinacion solicitada no valida: {combination!r}")
        biome, floor, item = combination["biome"], combination["floor"], combination["item"]
        source = "pickups" if item in (152, 153, 154, 155, 160, 161, 162) else biome
        for floor_attr in (0, 32, 64, 96):
            for item_attr in (0, 32, 64, 96):
                recipe = {"biome": biome, "kind": "normal", "layers": [
                    {"source": biome, "tile": floor, "attr": floor_attr, "x": 0, "y": 0},
                    {"source": source, "tile": item, "attr": item_attr, "x": 0, "y": 0},
                ]}
                key = recipe_key(recipe)
                if key not in seen:
                    seen.add(key)
                    recipes.append(recipe)
    if not recipes:
        raise ValueError("No hay combinaciones para generar")
    images = load_sources()
    atlas = Image.new("RGB", (COLS * 8, ((len(recipes) + COLS - 1) // COLS) * 8), PALETTE[0])
    binary = bytearray()
    tiles = []
    unique_data = []
    unique_previews = []
    variants = {}
    for index, recipe in enumerate(recipes):
        data, tile = encode_tile(compose(recipe, images))
        binary.extend(data)
        atlas.paste(tile, ((index % COLS) * 8, (index // COLS) * 8))
        key = bytes(data)
        if key not in variants:
            unique_index = len(unique_data)
            unique_data.append(key)
            unique_previews.append(tile)
            for flags in (0, 32, 64, 96):
                variant = flip_tile(key, flags & 32, flags & 64)
                variants.setdefault(variant, (unique_index, flags))
        unique_index, flags = variants[key]
        tiles.append({"id": index + 1, "offset": index * 16,
                      "unique": unique_index, "flip": flags, "recipe": recipe})
    unique_binary = b"".join(unique_data)
    unique_atlas = Image.new("RGB", (COLS * 8, ((len(unique_data) + 1 + COLS - 1) // COLS) * 8), PALETTE[0])
    for index, tile in enumerate(unique_previews):
        unique_atlas.paste(tile, ((index % COLS) * 8, (index // COLS) * 8))
    marker = Image.new("RGB", (8, 8))
    for y in range(8):
        for x in range(8):
            marker.putpixel((x, y), PALETTE[3 if (x + y) % 2 else 0])
    unique_atlas.paste(marker, ((len(unique_data) % COLS) * 8, (len(unique_data) // COLS) * 8))
    manifest = {
        "version": 1, "columns": COLS, "tileSize": 8, "count": len(tiles),
        "uniqueCount": len(unique_data),
        "uniqueSha256": hashlib.sha256(unique_binary).hexdigest(),
        "sourceSha256": {name: hashlib.sha256(path.read_bytes()).hexdigest() for name, path in ASSET_PATHS.items()},
        "tiles": tiles,
    }
    atlas.save(ATLAS)
    BINARY.write_bytes(binary)
    unique_atlas.save(UNIQUE_ATLAS)
    UNIQUE_BINARY.write_bytes(unique_binary)
    manifest["atlasSha256"] = hashlib.sha256(UNIQUE_ATLAS.read_bytes()).hexdigest()
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Generados {len(tiles)} tiles numerados; {len(unique_data)} graficos con mirrors, {len(unique_binary)} bytes 2bpp.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--include", type=Path, action="append", default=[],
                        help="Añade recetas de un registro adicional sin modificar las observaciones")
    main(parser.parse_args().include)
