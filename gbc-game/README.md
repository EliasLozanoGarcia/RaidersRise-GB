# Prototipo top-down con PNG a color original

## Ejecutar

Sirve la carpeta `gbc-game` desde un servidor HTTP local y abre `index.html`.
Por ejemplo, desde la raiz del repositorio:

```powershell
python -m http.server 8000 --directory .\gbc-game
```

Luego abre `http://localhost:8000`. El navegador bloquea la carga de los CSV
cuando se abre la pagina directamente con `file://`.

## Controles

| Accion | Jugador 1 | Jugador 2 |
|---|---|---|
| Mover | WASD | Flechas |
| Disparar | F | `,` |
| Unirse | Activo al iniciar | Pulsa cualquier control |

Pulsa `P` para pausar y `Enter` para reiniciar tras GAME OVER. Se admiten dos
mandos; el primero controla J1 y el segundo J2.

## Archivos activos

- `index.html` carga el motor, los controles, `js/loader_dmg.js` y `js/game.js`.
- `engine/gbc.js` conserva el motor de colisiones y el renderizador retro anterior.
- `assets/tileset_GBC_Urban.png` y `assets/Kathy_Sprites.png` son copias directas
  de los PNG a color de `ART/`; el juego los dibuja sin reducir ni cambiar sus
  colores. Los enemigos se dibujan desde `assets/enemies_run.png`.
- `maps/Leveltest._Fondo.csv` y `maps/Leveltest._Items.csv` son las capas del
  mapa exportadas desde Tiled.

Los datos de mapa usan los IDs locales exportados desde Tiled: el juego aplica
las banderas de volteo y dibuja cada tile directamente desde el PNG original.
El valor `-1` indica celdas vacias en la capa de items.
El conversor `tools/convert.py` corresponde al pipeline anterior de GBC; no es
necesario para ejecutar este prototipo.
