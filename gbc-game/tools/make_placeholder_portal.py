#!/usr/bin/env python3
"""Genera assets/portal.png PROVISIONAL (sustituyelo por tu spritesheet).
Formato asumido: celdas de 16x16, 8 columnas = 8 angulos (como Kathy: la primera
abajo-izquierda, en sentido horario), N filas = frames de animacion (aqui 2:
fila 0 = abriendose/cerrandose, fila 1 = abierto). 3 colores + transparente."""
import math, os
from PIL import Image
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIRS = [(-1, 1), (-1, 0), (-1, -1), (0, -1), (1, -1), (1, 0), (1, 1), (0, 1)]
C = {1: (60, 20, 110, 255), 2: (150, 70, 230, 255), 3: (235, 200, 255, 255)}
img = Image.new("RGBA", (128, 32), (255, 255, 255, 0))
for row, rad in enumerate([4.0, 7.0]):
    for col, (dx, dy) in enumerate(DIRS):
        n = math.hypot(dx, dy); ux, uy = dx / n, dy / n      # direccion de marcha
        vx, vy = -uy, ux                                       # perpendicular (eje largo del portal)
        for y in range(16):
            for x in range(16):
                px, py = x + 0.5 - 8, y + 0.5 - 8
                a = (px * vx + py * vy) / rad                  # a lo largo del portal
                b = (px * ux + py * uy) / 2.6                  # grosor
                r = math.hypot(a, b)
                if r <= 1.0:
                    k = 3 if r < 0.45 else 2 if r < 0.8 else 1
                    img.putpixel((col * 16 + x, row * 16 + y), C[k])
img.save(os.path.join(ROOT, "assets", "portal.png"))
print("assets/portal.png provisional generado")
