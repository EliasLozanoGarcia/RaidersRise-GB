"""Exporta TODOS los .tmx de Tiled de una vez:
  1) capas de tiles  -> maps/<mapa>_<capa>.csv   (con Tiled en linea de comandos)
  2) capa de objetos -> maps/<mapa>_Logic.json    (Start, End, EnemiSpawner; rectangulos [x, y, w, h])

Uso (desde la carpeta del proyecto):
    python tools/export_all.py
    python tools/export_all.py ../ART/Tilesmaps maps
    python tools/export_all.py --tiled "C:/Program Files/Tiled/tiled.exe"
    python tools/export_all.py --only Level1-3 Level1-99     # solo esos mapas
    python tools/export_all.py --no-csv                     # solo el JSON de logica
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

DEFAULT_SRC = "../ART/Tilesmaps"
DEFAULT_DST = "maps"

CANDIDATES = [
    r"C:\Program Files\Tiled\tiled.exe",
    r"C:\Program Files (x86)\Tiled\tiled.exe",
    "/Applications/Tiled.app/Contents/MacOS/Tiled",
    "/usr/bin/tiled",
    "/usr/local/bin/tiled",
    "/snap/bin/tiled",
]


def find_tiled(explicit):
    if explicit:
        return explicit
    found = shutil.which("tiled") or shutil.which("Tiled")
    if found:
        return found
    for c in CANDIDATES:
        if os.path.exists(c):
            return c
    sys.exit('No encuentro Tiled. Pasa su ruta con --tiled "ruta/a/tiled" (o usa --no-csv).')


def export_csv(tiled, tmx, dst):
    """Tiled crea un CSV por capa de tiles: <mapa>_<capa>.csv"""
    out = dst / (tmx.stem + ".csv")
    r = subprocess.run([tiled, "--export-map", "csv", str(tmx), str(out)], capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError((r.stderr or r.stdout).strip() or f"Tiled devolvio {r.returncode}")


def export_logic(tmx, dst):
    """Misma logica que convert_logic.py."""
    root = ET.parse(tmx).getroot()
    logic = {"start": None, "end": None, "spawners": []}
    for group in root.iter("objectgroup"):
        for obj in group.iter("object"):
            rect = [round(float(obj.get(k, 0))) for k in ("x", "y", "width", "height")]
            name = obj.get("name", "")
            if name == "Start":
                logic["start"] = rect
            elif name == "End":
                logic["end"] = rect
            elif name == "EnemiSpawner":
                logic["spawners"].append(rect)
    out = dst / f"{tmx.stem}_Logic.json"
    with open(out, "w") as f:
        json.dump(logic, f)
    return logic


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src", nargs="?", default=DEFAULT_SRC, help=f"carpeta con los .tmx (default: {DEFAULT_SRC})")
    ap.add_argument("dst", nargs="?", default=DEFAULT_DST, help=f"carpeta de salida (default: {DEFAULT_DST})")
    ap.add_argument("--tiled", help="ruta al ejecutable de Tiled")
    ap.add_argument("--only", nargs="+", metavar="MAPA", help="exportar solo estos mapas (sin extension)")
    ap.add_argument("--no-csv", action="store_true", help="no exportar CSV (solo JSON de logica)")
    ap.add_argument("--no-logic", action="store_true", help="no exportar JSON de logica (solo CSV)")
    args = ap.parse_args()

    src, dst = Path(args.src), Path(args.dst)
    maps = sorted(src.glob("*.tmx"))
    if args.only:
        maps = [m for m in maps if m.stem in args.only]
    if not maps:
        sys.exit(f"No hay .tmx en {src}")
    dst.mkdir(parents=True, exist_ok=True)
    tiled = None if args.no_csv else find_tiled(args.tiled)

    fails = 0
    for m in maps:
        status = []
        try:
            if tiled:
                export_csv(tiled, m, dst)
                status.append("CSV")
            if not args.no_logic:
                lg = export_logic(m, dst)
                status.append(f"Logic(start={'si' if lg['start'] else 'NO'}, end={'si' if lg['end'] else 'NO'}, spawners={len(lg['spawners'])})")
            print(f"OK    {m.stem}: " + ", ".join(status))
        except Exception as e:
            fails += 1
            print(f"FALLO {m.stem}: {e}")
    print(f"\n{len(maps) - fails}/{len(maps)} mapas exportados a {dst}/")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
