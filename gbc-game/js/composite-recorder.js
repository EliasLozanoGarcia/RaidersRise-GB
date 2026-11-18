"use strict";

window.CompositeRecorder = (() => {
  const endpoint = "/__composite_observations";
  const storageKey = "raiders-composite-observations-pending-v1";
  const status = document.getElementById("composite-status");
  const pending = new Map();
  const seen = new Set();
  let total = 0, timer = null, sending = false, storageFailed = false, captureFailed = false;

  function show(message) {
    if (status) status.textContent = message;
  }

  function fail(message) {
    captureFailed = true;
    console.error(message);
    show(`Error de registro: ${message}`);
  }

  function savePending() {
    try {
      localStorage.setItem(storageKey, JSON.stringify([...pending.values()]));
    } catch (error) {
      if (!storageFailed) console.error("No se pudieron guardar las combinaciones pendientes:", error);
      storageFailed = true;
      show("Error: no se pueden guardar las combinaciones pendientes en el navegador.");
    }
  }

  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "[]");
    if (!Array.isArray(saved)) throw new Error("Registro pendiente no valido");
    for (const combination of saved) {
      const key = JSON.stringify(combination);
      pending.set(key, combination);
      seen.add(key);
    }
  } catch (error) {
    storageFailed = true;
    console.error("No se pudo leer el registro pendiente de combinaciones:", error);
    show("Error al leer el registro pendiente de combinaciones.");
  }

  function schedule(delay) {
    if (timer === null) timer = setTimeout(flush, delay);
  }

  async function flush() {
    timer = null;
    if (sending || storageFailed) return;
    sending = true;
    const batch = [...pending.entries()].slice(0, 256);
    try {
      const response = await fetch(endpoint, batch.length ? {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ combinations: batch.map(([, value]) => value) })
      } : { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      if (!Number.isInteger(result.count)) throw new Error("Respuesta de registro no valida");
      for (const [key] of batch) pending.delete(key);
      total = result.count;
      savePending();
      if (!storageFailed && !captureFailed)
        show(`Combinaciones registradas: ${total}${total > 1024 ? " (supera 1024)" : " / 1024 objetivo"}${pending.size ? `; pendientes: ${pending.size}` : ""}`);
      if (pending.size) schedule(0);
    } catch (error) {
      console.error("No se pudo guardar el registro de combinaciones:", error);
      savePending();
      if (!storageFailed && !captureFailed)
        show(`Registro pendiente (${pending.size}): inicia node tools\\composite-server.js y abre su direccion.`);
      schedule(5000);
    } finally {
      sending = false;
    }
  }

  function record(combination) {
    const key = JSON.stringify(combination);
    if (seen.has(key)) return;
    seen.add(key);
    pending.set(key, combination);
    savePending();
    schedule(500);
  }

  window.addEventListener("pagehide", () => {
    savePending();
    if (pending.size && navigator.sendBeacon) {
      const batch = [...pending.values()].slice(0, 256);
      navigator.sendBeacon(endpoint, new Blob([JSON.stringify({ combinations: batch })], { type: "application/json" }));
    }
  });
  show("Conectando el registro de combinaciones...");
  schedule(0);
  return { record, fail };
})();
