"use strict";
/* Panel de ajuste en tiempo real (sliders sobre CFG). */

// Panel de ajuste en tiempo real: un slider por cada numero de CFG (y de CFG.enemyTypes).
(function buildTuningPanel() {
  const panel = document.getElementById("tuning");
  if (!panel) return;
  const addSlider = (group, obj, key, label, fixedMax) => {
    const def = obj[key];
    const frac = !Number.isInteger(def);
    const max = fixedMax || (def === 0 ? 10 : Math.abs(def) * 4);
    const row = document.createElement("label");
    const name = document.createElement("span");
    name.textContent = label;
    const input = document.createElement("input");
    input.type = "range";
    input.min = 0;
    input.max = frac ? Math.ceil(max * 100) / 100 : Math.ceil(max);
    input.step = frac ? (Math.abs(def) < 1 ? 0.01 : 0.05) : 1;
    input.value = def;
    const val = document.createElement("b");
    val.textContent = def;
    input.addEventListener("input", () => { obj[key] = Number(input.value); val.textContent = input.value; });
    input.addEventListener("change", () => input.blur());
    row.append(name, input, val);
    group.appendChild(row);
  };
  const addGroup = (title, obj, prefix) => {
    const group = document.createElement("fieldset");
    const legend = document.createElement("legend");
    legend.textContent = title;
    group.appendChild(legend);
    for (const key of Object.keys(obj)) {
      if (typeof obj[key] === "number" && !(obj === CFG && key.startsWith("wave") && key !== "wavePause")) addSlider(group, obj, key, prefix + key);
    }
    panel.appendChild(group);
  };
  const waves = document.createElement("fieldset");
  const wl = document.createElement("legend");
  wl.textContent = "Enemigos por oleada";
  waves.appendChild(wl);
  const WAVE_KEYS = { waveBase: "enemigos oleada 1", wavePerWave: "extra por oleada", waveMax: "maximo por oleada" };
  for (const k of Object.keys(WAVE_KEYS)) addSlider(waves, CFG, k, WAVE_KEYS[k], 300);
  panel.appendChild(waves);
  addGroup("Juego", CFG, "");
  for (const t of Object.keys(CFG.enemyTypes)) addGroup("Enemigo: " + t, CFG.enemyTypes[t], "");
})();

