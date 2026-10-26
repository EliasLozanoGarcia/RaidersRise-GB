# Prototipo DMG Game Boy

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
- `engine/gbc.js` implementa el render DMG de tiles y sprites.
- `assets/` contiene los tilesets y spritesheets leidos directamente al iniciar.
- `maps/Leveltest._Fondo.csv` y `maps/Leveltest._Items.csv` son las capas del
  mapa exportadas desde Tiled.

Los datos de mapa usan los GID de Tiled: el juego decodifica los GID, las
banderas de volteo y el valor `-1` usado para celdas vacias en la capa de items.
El conversor `tools/convert.py` corresponde al pipeline anterior de GBC; no es
necesario para ejecutar este prototipo.
