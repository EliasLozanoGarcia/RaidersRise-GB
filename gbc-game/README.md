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
| Teletransportarse (2 tiles, animado y con enfriamiento) | G | `.` |
| Unirse | Activo al iniciar | Pulsa cualquier control |

Para abrir un cofre o una puerta, mantente empujándolo en su dirección durante
1,5 segundos. La hoja de la puerta gira junto al marco y deja libre el paso. Si
dejas de empujar o te alejas antes de abrirlos, el progreso se reinicia. La
puerta abierta también responde al empuje con una animación breve. El personaje
muestra la animación de empuje al presionar contra cofres o puertas.

Pulsa `P` para pausar. Se admiten dos
mandos; el primero controla J1 y el segundo J2.

El juego arranca con una splash screen con tres opciones (Izq/Der y A): **Play**
(selección de personaje), **Raiders** (galería de personajes con ficha detallada)
y **Settings** (idioma, sonido, música y efectos; se guardan en `localStorage`; aún
no hay música en el juego). La pantalla de selección de
personaje (Izq/Der elegir, A confirmar, B cancelar; J2 se une pulsando A):

- **Kathy**: bazuca con explosión; especial en área 3x3 con daño continuo.
- **Kurt**: +50 % vida, más lento; ametralladora (15 balas/s con dispersión);
  especial 5x2 con daño x3 instantáneo.
- **Skreek**: +25 % vida, más rápido; espada (5 golpes/s, 2 tiles delante);
  especial: proyectil que atraviesa y destruye todo (SELECT con la barra llena).

Las balas detonan al acercarse a un enemigo y dañan a otros dentro del radio de
la explosión. Empujar un cofre durante 1,5 segundos suma cinco monedas al
inventario y deja monedas recogibles sobre el cofre y en celdas transitables
cercanas. Los enemigos derrotados también pueden soltar monedas: camina sobre
ellas para recogerlas; el total aparece en el HUD. Los enemigos varían
ligeramente su velocidad, vagan cuando están lejos y evitan amontonarse. J2
aparece junto a J1 cuando se une.

## Archivos activos

- `index.html` carga el motor, los controles, `js/loader_dmg.js` y `js/game.js`.
- `engine/gbc.js` conserva el motor de colisiones y el renderizador retro anterior.
- `assets/tileset_GBC_Urban.png`, `assets/Kathy_Sprites.png` y
  `assets/Teleport_GBC.png` son copias directas de los PNG de `ART/`; se dibujan
  sin reducir ni cambiar sus colores. Los enemigos se dibujan desde
  `assets/enemies_run.png`.
- `maps/Leveltest._Fondo.csv` y `maps/Leveltest._Items.csv` son las capas del
  mapa exportadas desde Tiled.
- `tools/convert_splash.py` convierte `assets/splash screen.png` en
  `assets/splash_tiles.png` (185 tiles únicos) y `maps/splash.json` (mapa de tiles).
- `tools/convert_portraits.py` recorta los retratos de `assets/selection Screen.png`
  y los pasa a 4 verdes (`assets/portraits.png`).
- Los textos usan `assets/font_8x8.png` (ancho proporcional): se componen en un
  buffer propio de 32 tiles (ids 128-159) y se pintan como tiles.
- Tiles compuestos: los items con transparencia (detectados por alfa en el tileset),
  las monedas (25) y las alertas (93 cofre, 126/127 cristal) se dibujan como un tile
  buffer (suelo + item) de un pool de 128 huecos, que se libera al desaparecer el item.
  Las monedas caen (1 px mas arriba durante 0,1 s) y salen escalonadas en grupos de 1-3.
  Al empujar un cofre o cristal, sus tiles superiores se cambian por la alerta.

Los datos de mapa usan los IDs locales exportados desde Tiled: el juego aplica
las banderas de volteo y dibuja cada tile directamente desde el PNG original.
El valor `-1` indica celdas vacias en la capa de items.
El conversor `tools/convert.py` corresponde al pipeline anterior de GBC; no es
necesario para ejecutar este prototipo.
