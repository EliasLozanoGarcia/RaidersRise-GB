# Prototipo top-down con PNG a color original

## Ejecutar

Sirve la carpeta `gbc-game` desde un servidor HTTP local y abre `index.html`.
Por ejemplo, desde la raiz del repositorio:

```powershell
python -m http.server 8000 --directory .\gbc-game
```

Luego abre `http://localhost:8000`. El navegador bloquea la carga de los CSV
cuando se abre la pagina directamente con `file://`.

### Registrar combinaciones de tiles

Para guardar automáticamente las combinaciones mientras juegas, inicia el
servidor de registro desde `gbc-game`:

```powershell
node .\tools\composite-server.js
```

Abre `http://127.0.0.1:8000` y deja el servidor ejecutándose. El contador bajo
el juego muestra el total guardado y las combinaciones pendientes. Se acumulan
en `composite-observations.json` entre partidas y reinicios; el objetivo de
1024 no limita el registro. Si el puerto está ocupado, usa otro con
`$env:PORT=8001; node .\tools\composite-server.js` y abre ese puerto.
Usa una sola instancia del servidor y una sola pestaña para este archivo.

El registro contiene recetas únicas observadas al construir tiles compuestos:
bioma, capas ordenadas, fuente, ID interno, espejos y desplazamiento. Recetas
distintas pueden producir los mismos píxeles, por lo que el total no es aún un
recuento exacto de gráficos únicos ni mide su frecuencia visual. Los cambios
de paleta aplicados posteriormente no son recetas adicionales.
Si falla la conexión, el navegador conserva los pendientes en su almacenamiento
local y reintenta; vuelve a abrir la misma dirección y puerto. Si aparece un
error de almacenamiento, no cierres la página antes de resolverlo.

### Generar y revisar tiles observados

Con Python y Pillow instalados, desde `gbc-game` ejecuta:

```powershell
python .\tools\generate_composites.py
```

La herramienta genera `assets/composite-tiles.png`, los datos GBC 2bpp en
`assets/composite-tiles.2bpp` y el catálogo `maps/composite-tiles.json`.
Los números empiezan en 1: el tile 1 está en los primeros 16 bytes, el tile 2
en los 16 siguientes, etc. Al volver a generar se conservan los números
existentes y se añaden los nuevos al final; no borres el catálogo si quieres
mantenerlos. Los gráficos se regeneran con los tilesets actuales.

Con el servidor local iniciado, abre `http://127.0.0.1:8000/composite-viewer.html`
para verlos ampliados, buscar un número y filtrar por bioma o tipo. El atlas
contiene los colores cuantizados del fondo GBC; el binario contiene los índices
de color 2bpp. En Urban solo los tiles de mapa 70, 71 y 72 (IDs desde cero)
usan transparencia de suelo; monedas, premios, avisos y especiales conservan
sus composiciones. Para los premios y el icono de aviso se usa el PNG Urban
transparente; el resto usa el PNG Urban editado. Desert y Snow no cambian.
`composite-required.json` añade los casos solicitados
expresamente, sin mezclarlos con las observaciones de partidas.

El juego utiliza `assets/composite-unique.2bpp`, que elimina duplicados y
espejos y recupera la orientación mediante los atributos GBC. Cuando aparece
una combinación que aún no está generada, muestra un patrón de cuadros y la
registra. Para incorporarla, espera a que se guarde el registro, ejecuta de
nuevo el generador y recarga el juego. Si modificas un tileset de bioma,
regenera los tiles antes de jugar; el inicio avisa si los archivos no coinciden.
Tras actualizar el servidor de registro, reinícialo para servir el formato
`.2bpp`.

El selector **Escala del juego** permite elegir entre el tamaño automático
(el predeterminado) y las escalas fijas 1:1, 1:2, 1:3 y 1:4. Las escalas fijas
mantienen píxeles enteros y pueden desbordar la ventana si esta es estrecha;
la resolución interna sigue siendo 160 × 144.

## Controles

| Accion | Jugador 1 | Jugador 2 |
|---|---|---|
| Mover | WASD | Flechas |
| Disparar | F | `,` |
| Apuntar / activar especial | Mantener / soltar R | Mantener / soltar `/` |
| Teletransportarse (2 tiles, animado y con enfriamiento) | G | `.` |
| Unirse | Activo al iniciar | Activo en Multiplayer |

Kurt y Skreek hacen un dash de aproximadamente 1 segundo en lugar de teletransportarse.
Durante el dash pueden cambiar de dirección con los controles de movimiento; al
soltarlos, continúan en la última dirección. El dash termina antes si chocan con
un obstáculo. Durante el dash son inmunes al daño y recogen monedas y objetos
que atraviesen.

Para abrir un cofre o una puerta, mantente empujándolo en su dirección durante
1,5 segundos. La hoja de la puerta gira junto al marco y deja libre el paso. Si
dejas de empujar o te alejas antes de abrirlos, el progreso se reinicia. La
puerta abierta solo se puede empujar desde la izquierda. Al iniciar el
desplazamiento de la puerta, el personaje avanza un pixel en la direccion del
empuje si no hay una colision que lo impida. Al empujar cofres o cristales,
el personaje mantiene fija la pose de empuje; al empujar puertas, la anima.
Si hay varios cofres al alcance, cada jugador empuja solo el más cercano.

Al bajar un muro, cada fase dura 0,4 segundos y la zona de juego vibra un pixel horizontalmente;
el HUD permanece fijo y la cámara no sigue a los jugadores hasta que termina
la vibración. Después retoma el seguimiento habitual. El efecto es trasladable
a Game Boy con scroll del fondo y desplazamiento equivalente de los sprites,
manteniendo el HUD en la ventana.

Pulsa `P` para pausar. En un mando, Y equivale a SELECT. Se admiten dos
mandos; el primero controla J1 y el segundo J2.
Durante la recarga aparece un icono parpadeante sobre el personaje.

El juego arranca con una splash screen con cuatro opciones (Arriba/Abajo y A):
**Single Player**, **Multiplayer**, **Raiders** (galería de personajes con ficha
detallada) y **About** (información legal y QR provisional de la versión móvil).
En About, mantén Arriba/Abajo para desplazar el contenido un píxel por frame;
B vuelve al menú. El QR utiliza los verdes de la paleta de Game Boy.
Single Player permite un jugador; Multiplayer requiere que ambos jugadores
confirmen sus personajes antes de comenzar. La pantalla de selección de
personaje usa Izq/Der para elegir, A para confirmar y B para cancelar. La
galería y la selección muestran los seis retratos del diseño; Baba, Maya y
Korin aparecen bloqueados porque todavía no están disponibles para jugar.
Las tarjetas tienen laterales diagonales y ocupan 5 × 5 tiles de 8 × 8 píxeles.
El fondo repite horizontalmente la primera columna de tiles del mockup.

- **Kathy**: bazuca con explosión; especial en área 3x3 con daño continuo.
- **Kurt**: +50 % vida, más lento; ametralladora (15 balas/s con dispersión);
  especial 5x2 con daño x3 instantáneo.
- **Skreek**: +25 % vida, más rápido; espada (5 golpes/s, 2 tiles delante);
  especial: proyectil que atraviesa enemigos y destruye obstáculos a su alcance.

Con la barra de especial llena, mantén R (o Y en un mando) para marcar el área
o trayectoria y suéltalo para activar la habilidad. El marcador y la explosión solo aparecen
en celdas sin colisión y en la mitad libre de los tiles de media colisión parcial;
las mitades bloqueadas, y los tiles de colisión completa, no se marcan. Las
monedas y los elementos transparentes se recomponen sobre el marcador.
Las áreas diagonales se giran y usan el tile diagonal volteado en sus bordes;
los especiales de suelo de Kathy y Kurt atraviesan obstáculos y dañan dentro
de toda el área, también al otro lado. Kathy repite los cuatro tiles de
explosión (157–160 en Tiled), 0,2 segundos cada uno, mientras su área está
activa; Kurt los reproduce una vez. Skreek no muestra explosión al lanzar su
proyectil. Los valores y ritmos de daño de los tres personajes no cambian.

Los proyectiles de la bazuca detonan al acercarse a un enemigo y dañan a otros
dentro del radio de la explosión. La espada, los proyectiles y las explosiones
de bazuca atraviesan las colisiones medias, pero no las totales;
los proyectiles permanecen inmóviles brevemente al impactar.
Kathy usa `assets/disparo_Big.png` para su bazuca; Kurt usa
`assets/disparo_Small.png` para su ametralladora.
Las balas de Kurt impactan con el área visible de los enemigos, sin modificar
sus colisiones de movimiento.
Las abejas atraviesan los tiles de colisión media, pero no los sólidos; los
personajes y enemigos terrestres no pueden atravesar ninguno de los dos.
Empujar un cofre durante 1,5 segundos suma monedas al
inventario y deja monedas recogibles sobre el cofre y en celdas transitables
cercanas. Los enemigos derrotados también pueden soltar monedas: camina sobre
ellas para recogerlas; el total aparece en el HUD. Los enemigos varían
ligeramente su velocidad, vagan cuando están lejos y evitan amontonarse. Al
recibir daño, personajes, enemigos y objetos usan brevemente la paleta
`#7A953A`, `#7A953A`, `#55742A`, `#2A4E19`. Al morir aparece durante 0,2 s
un efecto de 8 × 8 píxeles centrado sobre el enemigo.

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
del 10 %. Cuando todos los jugadores activos se quedan sin vida, la partida
termina y se muestran los niveles superados, enemigos derrotados, disparos,
tiempo y recursos. Las estadísticas se acumulan entre niveles; desde la
pantalla final se puede iniciar otra partida o volver al menú principal.

Los cristales grandes del mapa aparecen solo en los niveles 3, 6, 9, etc.
Para extraerlos hay que empujarlos durante 4,5 segundos mientras se sobrevive a
los enemigos existentes; no es obligatorio extraerlos para salir ni modifican
los precios de la tienda. El límite configurado sigue siendo de uno por defecto;
los cristales recogibles de las lucky blocks no cambian.

Las antiguas cajas de mana son **lucky blocks**: se iluminan al recibir daño
y tras tres impactos sueltan
al azar un corazon (+1 vida hasta el maximo), una
moneda, mana (+10 % de la barra), un cristal, un escudo o una llave.
En el primer nivel los premios son equiprobables; en niveles posteriores
la probabilidad de moneda se reduce con el mismo factor que la de los enemigos,
redistribuyendo el resto entre los premios que no son monedas ni mana, para
mantener la probabilidad de mana. El escudo protege de enemigos, pinchos y especiales durante 5 segundos;
recoger otro reinicia su duracion. Las llaves y granadas se acumulan pero aun no
tienen efecto. Cada jugador tiene su propio inventario; el HUD muestra vida,
mana, monedas y cristales. En multijugador alterna cada tres segundos entre
jugadores y muestra el número del jugador. Escudo, llaves y granadas no se
muestran en el HUD. Monedas, cristales, llaves y granadas se conservan al
avanzar de nivel. Los iconos de vida, moneda, mana y cristal corresponden a
los numeros de Tiled 153–156 (IDs internos 152–155).

## Archivos activos

- `index.html` carga el motor, los controles, el cargador y los módulos del juego
  hasta `js/main.js`, que contiene el bucle principal.
- `engine/gbc.js` implementa el mini-PPU del Game Boy Color, incluyendo VRAM,
  OAM, paletas, fondo, ventana y límites por línea.
- `js/render.js` convierte los recursos a 2bpp y dibuja tanto el juego como los
  menús. `engine/input.js` traduce teclado y mandos a botones de Game Boy.
- Los PNG se cargan sin aplicar el perfil de color incrustado y sin usar la
  cache HTTP, para conservar los valores RGB del archivo tras cada edicion.
  Al iniciar, el motor convierte los tiles a 2bpp: los fondos usan
  `#7A953A`, `#55742A`, `#2A4E19` y `#0F380F`; los sprites usan tres
  colores opacos y transparencia. El HUD y los
  nuevos iconos y explosiones utilizan el tileset Urban en todos los biomas;
  el escudo, la llave y la granada conservan los iconos anteriores de Desert.
  Los enemigos se dibujan desde
  `assets/enemies_run.png`, `assets/enemies_Bee.png` y
  `assets/enemies_Slug_Big.png`.
- Los niveles activos están en `maps/Level0-*` y `maps/Level1-*`. Cada nivel
  puede contener sus capas `Fondo`, `Items` y su archivo `Logic.json`; se
  exportan desde Tiled con `tools/export_all_maps.py`.
- `tools/convert_splash.py` convierte `assets/Splash_Screen.png` en
  `assets/splash_tiles.png` (191 tiles únicos) y `maps/splash.json` (mapa de tiles);
  borra las opciones originales para dibujar las opciones interactivas con la fuente.
- `assets/QR.png` es el QR provisional mostrado en About; habrá que sustituirlo
  cuando exista el enlace definitivo de la versión móvil.
- `assets/selection Screen.png` y `assets/riders Profile.png` aportan los
  gráficos de la galería, la selección de personaje y las fichas. Los nombres,
  estados, estadísticas y descripciones se dibujan según el personaje elegido.
- Los textos usan `assets/font_8x8.png` (ancho proporcional): se componen en un
  buffer propio de 32 tiles en el banco 1 (ids 160-191) y se pintan como tiles.
- Tiles compuestos: los elementos de escenario con transparencia detectados
  por alfa y las alertas (93 cofre, 126/127 cristal) se dibujan como un tile
  buffer (suelo + item) de un pool de 96 huecos (ids 160-255, filas 6-8), que se libera al desaparecer el item.
  Los objetos recogibles (corazón, moneda, mana, cristal, escudo, llave y
  granada) no forman parte de las combinaciones: se cargan en VRAM como sprites
  OAM de 8×8 y se dibujan directamente sobre el mapa.
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
Los recursos `composite-*` se generan con `tools/generate_composites.py`; no se
incluyen en el flujo los generados del pipeline anterior.
