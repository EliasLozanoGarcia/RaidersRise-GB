"use strict";

const scaleControl = document.getElementById("screen-scale");
const gameScreen = document.getElementById("screen");

scaleControl.addEventListener("change", () => {
  gameScreen.dataset.scale = scaleControl.value;
});

// Las flechas, Enter y Tab deben seguir funcionando en el selector.
for (const event of ["keydown", "keyup"]) {
  scaleControl.addEventListener(event, (e) => e.stopPropagation());
}
