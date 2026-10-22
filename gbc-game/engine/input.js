/*
 * Entrada: teclado + gamepads -> botones de Game Boy por jugador.
 * Cada jugador tiene una mascara de bits con UP/DOWN/LEFT/RIGHT/A/B/START/SELECT.
 */
(function () {
  "use strict";
  const BTN = { UP: 1, DOWN: 2, LEFT: 4, RIGHT: 8, A: 16, B: 32, START: 64, SELECT: 128 };

  // Teclado (por posicion fisica de la tecla, valido para QWERTY/espanol)
  const KEYMAP = [
    { // Jugador 1
      KeyW: BTN.UP, KeyS: BTN.DOWN, KeyA: BTN.LEFT, KeyD: BTN.RIGHT,
      KeyF: BTN.A, KeyG: BTN.B, Enter: BTN.START, Tab: BTN.SELECT,
    },
    { // Jugador 2
      ArrowUp: BTN.UP, ArrowDown: BTN.DOWN, ArrowLeft: BTN.LEFT, ArrowRight: BTN.RIGHT,
      Comma: BTN.A, Period: BTN.B, Slash: BTN.SELECT,
    },
  ];

  class Input {
    constructor() {
      this.keys = [0, 0];
      this.latch = [0, 0];   // pulsaciones del teclado que aun no ha visto ningun frame (no se pierden taps cortos)
      this.held = [0, 0];
      this.prev = [0, 0];
      this.pressed = [0, 0]; // flancos de subida de esta frame
      this.extraKeyHandlers = {};
      window.addEventListener("keydown", (e) => this._key(e, true));
      window.addEventListener("keyup", (e) => this._key(e, false));
      window.addEventListener("blur", () => { this.keys = [0, 0]; });
    }

    _key(e, down) {
      let used = false;
      for (let p = 0; p < 2; p++) {
        const b = KEYMAP[p][e.code];
        if (b) {
          used = true;
          if (down) { this.keys[p] |= b; this.latch[p] |= b; } else this.keys[p] &= ~b;
        }
      }
      if (used) e.preventDefault();
      if (down && !e.repeat && this.extraKeyHandlers[e.code]) {
        this.extraKeyHandlers[e.code]();
        e.preventDefault();
      }
    }

    _pad(gp) {
      let m = 0;
      const b = gp.buttons;
      const on = (i) => b[i] && b[i].pressed;
      if (on(12) || gp.axes[1] < -0.5) m |= BTN.UP;
      if (on(13) || gp.axes[1] > 0.5) m |= BTN.DOWN;
      if (on(14) || gp.axes[0] < -0.5) m |= BTN.LEFT;
      if (on(15) || gp.axes[0] > 0.5) m |= BTN.RIGHT;
      if (on(0) || on(2) || on(7)) m |= BTN.A;
      if (on(1) || on(3) || on(6)) m |= BTN.B;
      if (on(9)) m |= BTN.START;
      if (on(8)) m |= BTN.SELECT;
      return m;
    }

    // Llamar una vez por frame de juego
    poll() {
      const pads = (navigator.getGamepads ? Array.from(navigator.getGamepads()) : []).filter((g) => g && g.connected);
      for (let p = 0; p < 2; p++) {
        let m = this.keys[p] | this.latch[p];
        this.latch[p] = 0;
        if (pads[p]) m |= this._pad(pads[p]);
        this.prev[p] = this.held[p];
        this.held[p] = m;
        this.pressed[p] = m & ~this.prev[p];
      }
    }
  }

  window.BTN = BTN;
  window.Input = Input;
})();
