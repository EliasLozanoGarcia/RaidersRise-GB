# Prototipo top-down con PNG a color original

## Ejecutar

Sirve la carpeta `gbc-game` desde un servidor HTTP local y abre `index.html`.
Por ejemplo, desde la raiz del repositorio:

```powershell
python -m http.server 8000 --directory .\gbc-game
```

Luego abre `http://localhost:8000`. El navegador bloquea la carga de los CSV
cuando se abre la pagina directamente con `file://`.

El selector **Escala del juego** permite elegir entre el tamaño automático
(el predeterminado) y las escalas fijas 1:1, 1:2, 1:3 y 1:4. Las escalas fijas
mantienen píxeles enteros y pueden desbordar la ventana si esta es estrecha;
la resolución interna sigue siendo 160 × 144.

## Controles

| Accion | Jugador 1 | Jugador 2 |
|---|---|---|
| Mover | WASD | Flechas |
| Disparar | F | `,` |
| Apuntar / activar especial | Mantener / soltar Tab | Mantener / soltar `/` |
| Teletransportarse (2 tiles, animado y con enfriamiento) | G | `.` |
| Unirse | Activo al iniciar | Activo en Multiplayer |

Para abrir un cofre o una puerta, mantente empujándolo en su dirección durante
1,5 segundos. La hoja de la puerta gira junto al marco y deja libre el paso. Si
dejas de empujar o te alejas antes de abrirlos, el progreso se reinicia. La
puerta abierta solo se puede empujar desde la izquierda. Al iniciar el
desplazamiento de la puerta, el personaje avanza un pixel en la direccion del
empuje si no hay una colision que lo impida. El personaje muestra la animación
de empuje al presionar contra cofres o puertas.
Si hay varios cofres al alcance, cada jugador empuja solo el más cercano.

Al bajar un muro, cada fase dura 0,4 segundos y la zona de juego vibra un pixel horizontalmente;
el HUD permanece fijo y la cámara no sigue a los jugadores hasta que termina
la vibración. Después retoma el seguimiento habitual. El efecto es trasladable
a Game Boy con scroll del fondo y desplazamiento equivalente de los sprites,
manteniendo el HUD en la ventana.

Pulsa `P` para pausar. Se admiten dos
mandos; el primero controla J1 y el segundo J2.

El juego arranca con una splash screen con cuatro opciones (Arriba/Abajo y A):
**Single Player**, **Multiplayer**, **Raiders** (galería de personajes con ficha
detallada) y **About** (información legal y QR provisional de la versión móvil).
En About, Izq/Der cambia de página y B vuelve al menú.
Single Player permite un jugador; Multiplayer requiere que ambos jugadores
confirmen sus personajes antes de comenzar. La pantalla de selección de
personaje usa Izq/Der para elegir, A para confirmar y B para cancelar. La
galería y la selección muestran los seis retratos del diseño; Baba, Maya y
Korin aparecen bloqueados porque todavía no están disponibles para jugar:

- **Kathy**: bazuca con explosión; especial en área 3x3 con daño continuo.
- **Kurt**: +50 % vida, más lento; ametralladora (15 balas/s con dispersión);
  especial 5x2 con daño x3 instantáneo.
- **Skreek**: +25 % vida, más rápido; espada (5 golpes/s, 2 tiles delante);
  especial: proyectil que atraviesa y destruye todo.

Con la barra de especial llena, mantén SELECT para marcar el área o trayectoria
y suéltalo para activar la habilidad. El marcador y la explosión solo aparecen
en celdas sin colisión y en la mitad libre de los tiles de media colisión parcial;
las mitades bloqueadas, y los tiles de colisión completa, no se marcan. Las
monedas y los elementos transparentes se recomponen sobre el marcador.
Las áreas diagonales se giran y usan el tile diagonal volteado en sus bordes;
el daño de Kathy y Kurt sigue la misma forma. Kathy repite los cuatro tiles de
explosión (154–157 en Tiled), 0,2 segundos cada uno, mientras su área está
activa; Kurt los reproduce una vez. Skreek no muestra explosión al lanzar su
proyectil. Los valores y ritmos de daño de los tres personajes no cambian.

Las balas detonan al acercarse a un enemigo y dañan a otros dentro del radio de
la explosión. Las balas y las abejas atraviesan los tiles de colisión media,
pero no los sólidos; los personajes y enemigos terrestres no pueden atravesar
ninguno de los dos. Empujar un cofre durante 1,5 segundos suma monedas al
inventario y deja monedas recogibles sobre el cofre y en celdas transitables
cercanas. Los enemigos derrotados también pueden soltar monedas: camina sobre
ellas para recogerlas; el total aparece en el HUD. Los enemigos varían
ligeramente su velocidad, vagan cuando están lejos y evitan amontonarse.

Cada punto de aparición tiene sus propias oleadas: la siguiente comienza tras
eliminar a todos los enemigos de ese punto, sin esperar a los demás. Cada punto
tiene una oleada en los niveles 1–2, dos en 3–5, tres en 6–8 y cuatro en
9–11; después se añade otra cada tres niveles. El radio de persecución es 1×
en niveles 1–2, 1,25× en 3–5, 1,5× en 6–8 y 2× desde el 9. Un mapa sin
puntos no genera enemigos. Los puntos normales se reparten el total configurado
en el panel; los personalizados conservan su tipo y cantidad. Los intentos
bloqueados se repiten cuando haya espacio.

Los mapas se barajan independientemente del bioma: Urban se usa en los niveles
1–10, Desert en 11–20 y Snow en 21–30, repitiendo el ciclo. Puertas y bloques
están disponibles desde el principio, pinchos desde el nivel 4 y botones con
muros bajables desde el 7. Desde el 10 se elige aleatoriamente si aparece cada
tipo de trampa; al desactivar un muro también se retira su botón.

Cada nivel contiene uno o dos cofres elegidos al azar, más uno adicional en
los niveles de cristal. Se seleccionan mapas con suficientes ubicaciones y,
en niveles de cristal, con al menos un cristal. Las cajas de mana del mapa no
disminuyen con el nivel; las monedas colocadas en el mapa disminuyen una por
nivel hasta dejar una si había alguna. Cada cofre entrega una moneda directa menos por nivel
(de cinco hasta un mínimo de una) y deja una moneda recogible menos (de hasta
doce hasta un mínimo de una). Los enemigos que pueden soltar moneda pasan de
un 100 % de probabilidad en el nivel 1 a un 10 % menos por nivel, con mínimo
del 10 %. Al continuar tras morir se reinician las oleadas que estaban en
curso; las ya completadas no se repiten.

Los cristales grandes del mapa aparecen solo en los niveles 3, 6, 9, etc.
Para extraerlos hay que empujarlos durante 4,5 segundos mientras se sobrevive a
los enemigos existentes; no es obligatorio extraerlos para salir ni modifican
los precios de la tienda. El límite configurado sigue siendo de uno por defecto;
los cristales recogibles de las lucky blocks no cambian.

Las antiguas cajas de mana son **lucky blocks**: tras tres impactos sueltan
al azar un corazon (+1 vida hasta el maximo), una
moneda, mana (+10 % de la barra), un cristal, un escudo, una llave o una
granada. En el primer nivel los premios son equiprobables; en niveles posteriores
la probabilidad de moneda se reduce con el mismo factor que la de los enemigos,
redistribuyendo el resto entre los premios que no son monedas ni mana, para
mantener la probabilidad de mana. El escudo protege de enemigos, pinchos y especiales durante 5 segundos;
recoger otro reinicia su duracion. Las llaves y granadas se acumulan pero aun no
tienen efecto. Cada jugador tiene su propio inventario, visible en el HUD;
monedas, cristales, llaves y granadas se conservan al avanzar de nivel.
Los numeros de Tiled 147-153 corresponden a los IDs internos 146-152.

## Archivos activos

- `index.html` carga el motor, los controles, `js/loader_dmg.js` y `js/game.js`.
- `engine/gbc.js` conserva el motor de colisiones y el renderizador retro anterior.
- Los tilesets Urban, Desert y Snow, `assets/Kathy_Sprites.png` y
  `assets/Teleport_GBC.png` son copias directas de los PNG de `ART/`; se dibujan
  sin reducir ni cambiar sus colores. Los enemigos se dibujan desde
  `assets/enemies_run.png`.
- `maps/Leveltest._Fondo.csv` y `maps/Leveltest._Items.csv` son las capas del
  mapa exportadas desde Tiled.
- `tools/convert_splash.py` convierte `assets/Splash_Screen.png` en
  `assets/splash_tiles.png` (191 tiles únicos) y `maps/splash.json` (mapa de tiles);
  borra las opciones originales para dibujar las opciones interactivas con la fuente.
- `assets/QR.png` es el QR provisional mostrado en About; habrá que sustituirlo
  cuando exista el enlace definitivo de la versión móvil.
- `assets/selection Screen.png` y `assets/riders Profile.png` aportan los
  gráficos de la galería, la selección de personaje y las fichas. Los nombres,
  estados, estadísticas y descripciones se dibujan según el personaje elegido.
- Los textos usan `assets/font_8x8.png` (ancho proporcional): se componen en un
  buffer propio de 32 tiles sueltos (ids 74-92 y 106-118) y se pintan como tiles.
- Tiles compuestos: los items con transparencia (detectados por alfa en el tileset),
  las monedas (147, ID interno) y las alertas (93 cofre, 126/127 cristal) se dibujan como un tile
  buffer (suelo + item) de un pool de 96 huecos (ids 160-255, filas 6-8), que se libera al desaparecer el item.
  Los tiles 64-67 y 69-72 usan el color del suelo 49 como transparencia; si estan en la capa de fondo,
  o de items, se componen sobre el suelo 49. Los especiales sustituyen el suelo y conservan el objeto encima.
  Las monedas caen (1 px mas arriba durante 0,1 s) y salen escalonadas en grupos de 1-3.
  Al empujar un cofre o cristal, la alerta 93 se compone sobre sus tiles superiores originales.
- Logica en enteros (pensada para portarla a Game Boy): posiciones y velocidades en 8.8
  (256 = 1 px), angulos de 0-255 con tabla de seno y `atan2b`, RNG xorshift de 16 bits
  (`rnd`, `shuffle`), sin `Math.random/hypot/atan2/sin/cos` en el juego. Los
  multiplicadores de `CFG` y de los personajes tambien son 8.8; `fireDelay` son frames entre disparos.
- El hardware no tiene flip diagonal: las celdas del CSV con ese flag se ignoran al cargar.

Los datos de mapa usan los IDs locales exportados desde Tiled: el juego aplica
las banderas de volteo y dibuja cada tile directamente desde el PNG original.
El valor `-1` indica celdas vacias en la capa de items.
El conversor `tools/convert.py` corresponde al pipeline anterior de GBC; no es
necesario para ejecutar este prototipo.
