"""Extrae la capa de objetos "Logica" de un .tmx de Tiled a maps/<nombre>_Logic.json.

Uso: python tools/convert_logic.py ../ART/Tilesmaps/Level1-7.tmx maps/Level1-7_Logic.json

Objetos reconocidos (por nombre): Start, End, EnemiSpawner. Los rectangulos se
guardan en pixeles enteros [x, y, w, h].
"""
import json
import sys
import xml.etree.ElementTree as ET


def main(src, dst):
    root = ET.parse(src).getroot()
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
    with open(dst, "w") as f:
        json.dump(logic, f)
    print(dst, logic)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
