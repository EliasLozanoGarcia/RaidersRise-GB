"""Convierte la splash screen (160x144) a un atlas de tiles 8x8 unicos + mapa de tiles.

Uso: python tools/convert_splash.py
Salida: assets/splash_tiles.png (16 tiles por fila) y maps/splash.json ({w, h, cols, tiles}).
Se borran los textos de las opciones: el menu se pinta en tiempo de ejecucion.
"""
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
src = Image.open(ROOT / "assets" / "Splash_Screen.png").convert("RGB")
if src.size != (160, 144):
    raise ValueError(f"La splash debe medir 160x144, no {src.size}")

# Borra las opciones y flechas originales; el juego las pinta con su fuente.
px = src.load()
for y in range(104, 128):
    for x in range(0, 160):
        px[x, y] = px[158, y]

# Un pixel suelto fuera de la paleta de 4 verdes se lleva al verde mas cercano.
pal = [(15, 56, 15), (42, 78, 25), (85, 116, 42), (122, 149, 58)]
for y in range(src.height):
    for x in range(src.width):
        c = px[x, y]
        if c not in pal:
            px[x, y] = min(pal, key=lambda p: sum((a - b) ** 2 for a, b in zip(p, c)))

tiles, index, grid = [], {}, []
for ty in range(src.height // 8):
    for tx in range(src.width // 8):
        t = src.crop((tx * 8, ty * 8, tx * 8 + 8, ty * 8 + 8))
        key = t.tobytes()
        if key not in index:
            index[key] = len(tiles)
            tiles.append(t)
        grid.append(index[key])

cols = 16
atlas = Image.new("RGB", (cols * 8, ((len(tiles) + cols - 1) // cols) * 8))
for i, t in enumerate(tiles):
    atlas.paste(t, ((i % cols) * 8, (i // cols) * 8))
atlas.save(ROOT / "assets" / "splash_tiles.png")
(ROOT / "maps" / "splash.json").write_text(
    json.dumps({"w": src.width // 8, "h": src.height // 8, "cols": cols, "tiles": grid}, separators=(",", ":"))
)
print(f"{len(tiles)} tiles unicos de {len(grid)}")
