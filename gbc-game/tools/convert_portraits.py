"""Recorta los 3 retratos de 'selection Screen.png' y los pasa a la paleta de 4 verdes.

Uso: python tools/convert_portraits.py
Salida: assets/portraits.png (90x30: Kathy, Kurt, Skreel de 30x30 cada uno).
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
src = Image.open(ROOT / "assets" / "selection Screen.png").convert("RGB")

PAL = [(15, 56, 15), (42, 78, 25), (85, 116, 42), (122, 149, 58)]
BOXES = [(25, 25), (65, 25), (105, 25)]
SIZE = 30

out = Image.new("RGB", (SIZE * len(BOXES), SIZE))
for n, (bx, by) in enumerate(BOXES):
    crop = src.crop((bx, by, bx + SIZE, by + SIZE))
    lum = [0.299 * r + 0.587 * g + 0.114 * b for r, g, b in crop.getdata()]
    # Se estira el rango de luminancia de cada retrato para aprovechar los 4 verdes.
    s = sorted(lum)
    lo, hi = s[int(len(s) * 0.03)], s[int(len(s) * 0.97)]
    px = []
    for v in lum:
        t = min(1.0, max(0.0, (v - lo) / max(1.0, hi - lo)))
        px.append(PAL[min(3, int(t * 4))])
    tile = Image.new("RGB", (SIZE, SIZE))
    tile.putdata(px)
    out.paste(tile, (n * SIZE, 0))
out.save(ROOT / "assets" / "portraits.png")
print("ok", out.size)
