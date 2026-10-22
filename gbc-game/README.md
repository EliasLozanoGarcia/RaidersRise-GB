# Prototipo GBC – acción top-down 2 jugadores

## Ejecutar
Doble clic en `index.html` (Chrome/Edge/Firefox). No hay que instalar nada.

## Controles
| | J1 | J2 |
|---|---|---|
| Mover | WASD | Flechas |
| Disparar (A) | F | `,` |
| B: teleport | G | `.` |

Gamepad 1 → J1, gamepad 2 → J2. El J2 entra al pulsar cualquier botón.
`Enter` reinicia tras GAME OVER · `P` pausa.
Los ajustes de juego (velocidades, distancia de persecución, radio de explosión, enemigos por oleada...) están en los deslizadores bajo la pantalla y en `CFG` de `game/game.js`.
Depuración: `1` hitboxes y colisión · `2` filtro de color LCD · `3` efecto por scanline · `4` estrés de sprites.

## Estructura
- `index.html` – página
- `engine/gbc.js` – mini-PPU de GBC (tiles, mapas, OAM 40/10 por línea, paletas RGB555, window, hook por scanline)
- `engine/input.js` – teclado y gamepads → botones GB
- `game/game.js` – el juego (parámetros en `CFG` arriba del archivo)
- `assets/` – tus PNG originales
- `assets.js` – GENERADO por la herramienta de conversión
- `tools/convert.py` – valida/ajusta los PNG y genera `assets.js` y `preview/`

## Cambiar gráficos
1. Sustituye los PNG de `assets/` (mismos nombres y mismas rejillas).
2. `python3 tools/convert.py` (necesita Python 3 con `pillow` y `numpy`).
3. Lee `preview/report.txt`: indica cada error exacto y qué se ha corregido.
4. Recarga `index.html`.
