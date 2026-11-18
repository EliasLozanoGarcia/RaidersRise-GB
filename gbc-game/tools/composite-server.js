"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const ROOT = path.resolve(__dirname, "..");
const FILE = path.join(ROOT, "composite-observations.json");
const ENDPOINT = "/__composite_observations";
const LIMIT = 1024 * 1024;
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8"
};
const SOURCES = new Set([
  "urban", "desert", "snow", "pickups",
  "biome-transparent", "biome-hit", "biome-transparent-hit", "biome-lucky-hit", "pickups-hit"
]);

function normalize(entry) {
  if (!entry || !["urban", "desert", "snow"].includes(entry.biome) ||
      !["normal", "special", "special-fallback"].includes(entry.kind) ||
      !Array.isArray(entry.layers) || entry.layers.length < 1 || entry.layers.length > 8)
    throw new Error("Combinacion no valida");
  const layers = entry.layers.map((layer) => {
    if (!layer || !SOURCES.has(layer.source) || !Number.isInteger(layer.tile) ||
        layer.tile < 0 || layer.tile > 255 || !Number.isInteger(layer.attr) ||
        layer.attr < 0 || layer.attr > 255 || !Number.isInteger(layer.x) ||
        !Number.isInteger(layer.y) || Math.abs(layer.x) > 8 || Math.abs(layer.y) > 8)
      throw new Error("Capa no valida");
    return { source: layer.source, tile: layer.tile, attr: layer.attr, x: layer.x, y: layer.y };
  });
  return { biome: entry.biome, kind: entry.kind, layers };
}

function createServer(root = ROOT, file = FILE) {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  if (raw.version !== 1 || !Array.isArray(raw.combinations))
    throw new Error(`Archivo de combinaciones no valido: ${file}`);
  const combinations = new Map();
  for (const entry of raw.combinations) {
    const normalized = normalize(entry);
    combinations.set(JSON.stringify(normalized), normalized);
  }
  const realRoot = fs.realpathSync(root);
  const send = (res, code, body) => {
    res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify(body));
  };
  return http.createServer((req, res) => {
    let url;
    try { url = new URL(req.url, "http://localhost"); }
    catch { send(res, 400, { error: "URL no valida" }); return; }
    if (url.pathname === ENDPOINT) {
      if (req.method === "GET") { send(res, 200, { count: combinations.size }); return; }
      if (req.method !== "POST") { send(res, 405, { error: "Metodo no permitido" }); return; }
      if (!(req.headers["content-type"] || "").toLowerCase().startsWith("application/json") ||
          (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`)) {
        send(res, 403, { error: "Origen o contenido no permitido" }); return;
      }
      let size = 0, chunks = [], tooLarge = false;
      req.on("data", (chunk) => {
        size += chunk.length;
        if (size > LIMIT) { tooLarge = true; chunks = []; }
        else if (!tooLarge) chunks.push(chunk);
      });
      req.on("end", () => {
        if (tooLarge) { send(res, 413, { error: "Solicitud demasiado grande" }); return; }
        let entries;
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (!Array.isArray(body.combinations) || body.combinations.length > 256)
            throw new Error("Lista de combinaciones no valida");
          entries = body.combinations.map(normalize);
        } catch (error) { send(res, 400, { error: error.message }); return; }
        const next = new Map(combinations);
        for (const entry of entries) next.set(JSON.stringify(entry), entry);
        if (next.size !== combinations.size) {
          const temp = `${file}.${randomUUID()}.tmp`;
          let created = false;
          try {
            fs.writeFileSync(temp, JSON.stringify({ version: 1, combinations: [...next.values()] }, null, 2) + "\n", { flag: "wx" });
            created = true;
            fs.renameSync(temp, file);
          } catch (error) {
            if (created) {
              try { fs.unlinkSync(temp); } catch (cleanupError) { console.error("No se pudo borrar el temporal:", cleanupError); }
            }
            console.error("No se pudo guardar el registro:", error);
            send(res, 500, { error: "No se pudo guardar el archivo" }); return;
          }
          for (const [key, value] of next) combinations.set(key, value);
        }
        send(res, 200, { count: combinations.size });
      });
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") { send(res, 405, { error: "Metodo no permitido" }); return; }
    let target;
    try {
      const name = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
      target = fs.realpathSync(path.resolve(realRoot, "." + name));
      if (!target.toLowerCase().startsWith((realRoot + path.sep).toLowerCase()) ||
          !MIME[path.extname(target).toLowerCase()]) throw new Error("Archivo no permitido");
      const data = fs.readFileSync(target);
      res.writeHead(200, { "Content-Type": MIME[path.extname(target).toLowerCase()], "Cache-Control": "no-store" });
      res.end(req.method === "HEAD" ? undefined : data);
    } catch {
      send(res, 404, { error: "Archivo no encontrado" });
    }
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT || 8000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT no valido");
  createServer().listen(port, "127.0.0.1", () => {
    console.log(`Juego y registro disponibles en http://127.0.0.1:${port}`);
    console.log(`Archivo: ${FILE}`);
  });
}

module.exports = { createServer };
