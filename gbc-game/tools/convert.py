#!/usr/bin/env python3
"""
Conversor de assets para el motor GBC.

Uso (desde la carpeta del proyecto):
    python3 tools/convert.py

Lee assets/*.png, valida contra los limites de la Game Boy Color, AJUSTA lo que
puede (y te dice exactamente que ha cambiado) y genera:
    assets.js                 datos para el juego (tiles 2bpp, paletas RGB555, mapa)
    preview/*.png             vistas previas para revisar el resultado
    preview/report.txt        informe completo

Limites que aplica:
    - Color RGB555 (5 bits por canal)
    - Sprites: 3 colores + transparente por paleta, 8 paletas OBJ
    - Fondo: 4 colores por tile, 8 paletas BG (aqui 6 para el mapa; 2 reservadas
      para la moneda en el suelo y el HUD)
    - Tiles 8x8, 2 bits por pixel, deduplicados con flip horizontal/vertical
      (la GBC NO puede rotar tiles, solo reflejarlos)
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets")
PREVIEW = os.path.join(ROOT, "preview")
os.makedirs(PREVIEW, exist_ok=True)

LOG = []


def log(msg):
    LOG.append(msg)
    print(msg)


# ---------------------------------------------------------------- color utils
def c5(c):
    return tuple(int(round(int(v) * 31 / 255)) for v in c[:3])


def c8(c):
    return tuple((v << 3) | (v >> 2) for v in c)


def lum(c):
    return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]


WGT = (2, 4, 3)


def dist(a, b):
    return sum(WGT[i] * (a[i] - b[i]) ** 2 for i in range(3))


def pack555(c):
    return c[0] | (c[1] << 5) | (c[2] << 10)


def load_rgba(name):
    return np.array(Image.open(os.path.join(ASSETS, name)).convert("RGBA"))


# ------------------------------------------------------------ tile utilities
def enc_tile(t):
    """8x8 de indices 0..3 -> 16 bytes en formato Game Boy (2 planos por fila)."""
    out = []
    for y in range(8):
        lo = hi = 0
        for x in range(8):
            v = int(t[y][x])
            lo = (lo << 1) | (v & 1)
            hi = (hi << 1) | ((v >> 1) & 1)
        out += [lo, hi]
    return out


def variants(t):
    # (xflip, yflip) -> array
    return {
        (0, 0): t,
        (1, 0): t[:, ::-1],
        (0, 1): t[::-1, :],
        (1, 1): t[::-1, ::-1],
    }


class TilePool:
    """Pool de tiles unicos considerando flip H/V."""

    def __init__(self):
        self.tiles = []  # arrays canonicos
        self.index = {}  # bytes canonico -> id

    def add(self, t):
        t = np.ascontiguousarray(t, dtype=np.uint8)
        vs = variants(t)
        canon_key = min(v.tobytes() for v in vs.values())
        if canon_key not in self.index:
            self.index[canon_key] = len(self.tiles)
            self.tiles.append(np.frombuffer(canon_key, dtype=np.uint8).reshape(8, 8).copy())
        tid = self.index[canon_key]
        canon = self.tiles[tid]
        for (fx, fy), _ in variants(canon).items():
            if variants(canon)[(fx, fy)].tobytes() == t.tobytes():
                return tid, fx, fy
        raise RuntimeError("no deberia ocurrir")


# ------------------------------------------------------------------ sprites
def fit_sprite_sheet(name, arr, max_colors=3):
    """Devuelve (paleta5 [<=3 colores ordenados por luminancia], indices HxW 0=transp)."""
    h, w, _ = arr.shape
    semi = [(x, y, int(arr[y, x, 3])) for y in range(h) for x in range(w) if 0 < arr[y, x, 3] < 255]
    if semi:
        log(f"  AVISO {name}: {len(semi)} pixeles semitransparentes; se tratan como opacos si alpha>=128")
    opaque = arr[:, :, 3] >= 128
    q = np.zeros((h, w, 3), dtype=np.int32)
    freq = {}
    for y in range(h):
        for x in range(w):
            if opaque[y, x]:
                c = c5(arr[y, x])
                q[y, x] = c
                freq[c] = freq.get(c, 0) + 1
    keep = sorted(freq, key=lambda c: -freq[c])[:max_colors]
    pal = sorted(keep, key=lum)
    if len(freq) > max_colors:
        log(f"  ERROR (corregido) {name}: {len(freq)} colores opacos, maximo {max_colors} + transparente")
    idx = np.zeros((h, w), dtype=np.uint8)
    for y in range(h):
        for x in range(w):
            if not opaque[y, x]:
                continue
            c = tuple(int(v) for v in q[y, x])
            if c in pal:
                idx[y, x] = pal.index(c) + 1
            else:
                best = min(pal, key=lambda p: dist(p, c))
                idx[y, x] = pal.index(best) + 1
                log(
                    f"     pixel ({x},{y}) [{name}] RGB{c8(c)} -> RGB{c8(best)} "
                    f"(fila {y // 16 + 1}, col {x // 16 + 1} si es rejilla 16x16)"
                )
    return pal, idx


def frame_parts(idx, pool, x0, y0, w, h):
    """Trocea un frame en tiles 8x8; None si el tile esta vacio."""
    parts = []
    for ty in range(h // 8):
        for tx in range(w // 8):
            t = idx[y0 + ty * 8 : y0 + ty * 8 + 8, x0 + tx * 8 : x0 + tx * 8 + 8]
            if not t.any():
                parts.append(None)
                continue
            tid, fx, fy = pool.add(t)
            parts.append([tid, (0x20 if fx else 0) | (0x40 if fy else 0)])
    return parts


# --------------------------------------------------------------- BG palettes
def fit_bg_palettes(tiles5, npal, iters=30):
    """
    tiles5: lista de arrays (8,8,3) en RGB555 (enteros 0..31).
    Devuelve (paletas [npal][4 colores], asignacion por tile).
    """
    # color sets por tile con conteos
    info = []
    for t in tiles5:
        cnt = {}
        for p in t.reshape(-1, 3):
            k = tuple(int(v) for v in p)
            cnt[k] = cnt.get(k, 0) + 1
        info.append(cnt)

    def err(cnt, pal):
        return sum(n * min(dist(c, p) for p in pal) for c, n in cnt.items())

    # candidatos: conjuntos de colores exactos (<=4)
    cands = {}
    for cnt in info:
        if len(cnt) <= 4:
            cands[tuple(sorted(cnt))] = True
    cands = [list(c) for c in cands]

    chosen = []
    for _ in range(npal):
        best, besterr = None, None
        for c in cands:
            pals = chosen + [c]
            e = sum(min(err(cnt, p) for p in pals) for cnt in info)
            if besterr is None or e < besterr:
                best, besterr = c, e
        chosen.append(list(best))
    pals = [list(p) + [p[-1]] * (4 - len(p)) for p in chosen]

    assign = [0] * len(info)
    for _ in range(iters):
        changed = False
        for i, cnt in enumerate(info):
            a = min(range(npal), key=lambda k: err(cnt, pals[k]))
            if a != assign[i]:
                changed = True
            assign[i] = a
        for k in range(npal):
            pix = {}
            for i, cnt in enumerate(info):
                if assign[i] == k:
                    for c, n in cnt.items():
                        pix[c] = pix.get(c, 0) + n
            if not pix:
                continue
            if len(pix) <= 4:
                cs = list(pix)
                pals[k] = cs + [cs[-1]] * (4 - len(cs))
                continue
            cent = list(pals[k])
            for _ in range(12):
                groups = [[] for _ in range(4)]
                for c, n in pix.items():
                    j = min(range(4), key=lambda q: dist(c, cent[q]))
                    groups[j].append((c, n))
                for j in range(4):
                    if groups[j]:
                        tot = sum(n for _, n in groups[j])
                        cent[j] = tuple(
                            int(round(sum(c[ch] * n for c, n in groups[j]) / tot)) for ch in range(3)
                        )
            pals[k] = cent
        if not changed:
            break
    # ordenar cada paleta por luminancia (indices consistentes entre paletas)
    pals = [sorted(p, key=lum) for p in pals]
    return pals, assign


# --------------------------------------------------------------------- main
def main():
    out = {}
    report_extra = []

    # ---------------------------------------------------------------- Kathy
    log("== Kathy_Run.png ==")
    k = load_rgba("Kathy_Run.png")
    h, w = k.shape[:2]
    if (w, h) != (128, 80):
        log(f"  AVISO: tamano {w}x{h}, esperado 128x80 (8 columnas x 5 filas de 16x16)")
    kpal, kidx = fit_sprite_sheet("Kathy_Run.png", k)
    obj_pool = TilePool()
    kathy_frames = []
    for r in range(h // 16):
        row = []
        for c in range(w // 16):
            # orden de partes: arriba-izq, arriba-der, abajo-izq, abajo-der
            row.append(frame_parts(kidx, obj_pool, c * 16, r * 16, 16, 16))
        kathy_frames.append(row)

    # Boca del bazoka: pixel aislado del color mas claro (indice mas alto) de cada frame
    top = len(kpal)
    muzzle = []
    for r in range(h // 16):
        mrow = []
        for c in range(w // 16):
            f = kidx[r * 16:(r + 1) * 16, c * 16:(c + 1) * 16]
            found = []
            for y in range(16):
                for x in range(16):
                    if f[y, x] == top:
                        nb = f[max(0, y - 1):y + 2, max(0, x - 1):x + 2]
                        if int((nb == top).sum()) == 1:
                            found.append((x, y))
            if len(found) != 1:
                log(f"  AVISO Kathy fila {r + 1} col {c + 1}: {len(found)} pixeles de boca de canon "
                    f"(esperado 1 pixel amarillo aislado): {found}")
            mrow.append(list(found[0]) if found else [8, 8])
        muzzle.append(mrow)
    log(f"  boca del bazoka localizada en {len(muzzle) * len(muzzle[0])} frames")
    n_kathy_tiles = len(obj_pool.tiles)

    # ---------------------------------------------------------------- enemigo
    log("== enemies_run.png ==")
    e = load_rgba("enemies_run.png")
    eh, ew = e.shape[:2]
    epal, eidx = fit_sprite_sheet("enemies_run.png", e)
    enemy_frames = []
    for r in range(eh // 8):
        enemy_frames.append([frame_parts(eidx, obj_pool, c * 8, r * 8, 8, 8) for c in range(ew // 8)])

    # --------------------------------------------------------------- proyectil
    log("== disparo.png ==")
    b = load_rgba("disparo.png")
    bpal, bidx = fit_sprite_sheet("disparo.png", b)
    bullet_frame = frame_parts(bidx, obj_pool, 0, 0, 8, 8)
    bys, bxs = np.where(bidx > 0)
    bullet_center = [float(bxs.min() + bxs.max() + 1) / 2, float(bys.min() + bys.max() + 1) / 2]

    # ---------------------------------------------------------------- portal
    portal_frames = None
    ppal = None
    if os.path.exists(os.path.join(ASSETS, "portal.png")):
        log("== portal.png ==")
        pt = load_rgba("portal.png")
        ph, pw = pt.shape[:2]
        if pw != 128 or ph % 16:
            log(f"  AVISO: tamano {pw}x{ph}; se espera 128 de ancho (8 angulos de 16x16) y alto multiplo de 16 (frames)")
        ppal, pidx = fit_sprite_sheet("portal.png", pt)
        portal_frames = [[frame_parts(pidx, obj_pool, c * 16, r * 16, 16, 16) for c in range(pw // 16)]
                         for r in range(ph // 16)]
        log(f"  {ph // 16} filas (frames de animacion) x {pw // 16} angulos")
    else:
        log("== portal.png == NO ENCONTRADO (el teleport funciona sin dibujo de portal)")

    # ---------------------------------------------------------------- mapa
    log("== map.png ==")
    m = np.array(Image.open(os.path.join(ASSETS, "map.png")).convert("RGB"))
    mh, mw = m.shape[:2]
    if mw % 8 or mh % 8:
        log(f"  ERROR: el mapa mide {mw}x{mh}, debe ser multiplo de 8")
    gw, gh = mw // 8, mh // 8
    log(f"  {gw}x{gh} tiles ({gw * gh} en total)")
    m5 = np.array([[c5(m[y, x]) for x in range(mw)] for y in range(mh)], dtype=np.int32)
    n_orig = len({tuple(p) for p in m.reshape(-1, 3)})
    n_555 = len({tuple(p) for p in m5.reshape(-1, 3)})
    log(f"  colores: {n_orig} originales, {n_555} tras pasar a RGB555")

    tiles5 = []
    for ty in range(gh):
        for tx in range(gw):
            tiles5.append(m5[ty * 8 : ty * 8 + 8, tx * 8 : tx * 8 + 8])

    # estadisticas de duplicados (sobre el original, antes de ajustar paletas)
    def stat(keyf):
        s = set()
        for t in tiles5:
            s.add(keyf(t))
        return len(s)

    exact = stat(lambda t: t.tobytes())
    flips = stat(lambda t: min(
        np.ascontiguousarray(t[::sy, ::sx]).tobytes() for sx in (1, -1) for sy in (1, -1)))
    rots = stat(lambda t: min(
        np.ascontiguousarray(np.rot90(t[:, ::sx], k)).tobytes() for sx in (1, -1) for k in range(4)))
    log(f"  tiles unicos: {exact} exactos, {flips} con flip H/V (valido en GBC), "
        f"{rots} si ademas se rotara (NO valido en GBC)")

    NPAL = 6
    pals, assign = fit_bg_palettes(tiles5, NPAL)
    changed = []
    bg_pool = TilePool()
    tile_map = []
    attr_map = []
    new_img = np.zeros_like(m5)
    for i, t in enumerate(tiles5):
        pal = pals[assign[i]]
        idx = np.zeros((8, 8), dtype=np.uint8)
        maxd = 0
        for y in range(8):
            for x in range(8):
                c = tuple(int(v) for v in t[y, x])
                j = min(range(4), key=lambda q: dist(c, pal[q]))
                idx[y, x] = j
                maxd = max(maxd, dist(c, pal[j]))
                new_img[(i // gw) * 8 + y, (i % gw) * 8 + x] = pal[j]
        if maxd > 0:
            changed.append((i % gw, i // gw, maxd))
        tid, fx, fy = bg_pool.add(idx)
        tile_map.append(tid)
        attr_map.append(assign[i] | (0x20 if fx else 0) | (0x40 if fy else 0))

    # colores originales por tile >4 (informe del error exacto)
    over = []
    for i, t in enumerate(tiles5):
        n = len({tuple(p) for p in t.reshape(-1, 3)})
        if n > 4:
            over.append((i % gw, i // gw, n))
    if over:
        log(f"  ERROR (corregido): {len(over)} tiles con mas de 4 colores:")
        for x, y, n in over:
            log(f"     tile ({x},{y}) -> {n} colores")
    pal_needed_msg = (
        f"  Las paletas originales NO caben en {NPAL} paletas BG de 4 colores; "
        f"se han recalculado automaticamente."
    )
    exact_ok = len(changed) == 0
    if not exact_ok:
        log(pal_needed_msg)
        log(f"  {len(changed)} tiles modificados por el ajuste (de {gw * gh}):")
        for x, y, d in changed[:40]:
            log(f"     tile ({x},{y}) error de color max {d ** 0.5:.0f} (escala 0-255 ponderada)")
        if len(changed) > 40:
            log(f"     ... y {len(changed) - 40} mas (ver preview/map_diff.png)")
    else:
        log(f"  OK: el mapa cabe exacto en {NPAL} paletas BG sin cambios")
    log(f"  tiles VRAM tras ajuste: {len(bg_pool.tiles)} (con flip H/V y compartiendo indices entre paletas)")

    # colision automatica (PROPUESTA): un tile es solido si contiene colores de
    # tuberia azul, caja verde oscuro o borde marron. Revisa preview/collision.png.
    wall_cols = {c5(c) for c in [
        (36, 54, 91), (72, 91, 127), (127, 163, 200), (182, 200, 236),   # tuberias azules
        (62, 76, 48), (94, 105, 59),                                     # cajas/barriles verdes
        (91, 72, 54), (109, 91, 72), (145, 109, 72), (109, 72, 54), (126, 90, 63),  # marron
    ]}
    solid = []
    for t in tiles5:
        cols_in = {tuple(int(v) for v in p) for p in t.reshape(-1, 3)}
        solid.append(1 if cols_in & wall_cols else 0)
    log(f"  colision automatica: {sum(solid)} tiles solidos de {gw * gh} (revisar preview/collision.png)")

    # moneda como tile de fondo
    log("== moneda.png ==")
    coin = load_rgba("moneda.png")
    cpal, cidx = fit_sprite_sheet("moneda.png", coin)
    # color de suelo = color mas frecuente de las paletas del mapa
    from collections import Counter
    floor = Counter(tuple(int(v) for v in p) for p in m5.reshape(-1, 3)).most_common(1)[0][0]
    # elegimos el color de suelo mas "liso": el de tile mas repetido
    coin_pal = [floor] + cpal  # indice 0 = suelo (la moneda va pintada sobre el suelo)
    coin_idx = cidx.copy()
    coin_tile_id = len(bg_pool.tiles)
    coin_bytes = enc_tile(coin_idx)
    log(f"  moneda como tile de fondo sobre suelo RGB{c8(floor)}; paleta BG 6")

    # --------------------------------------------------- paletas de sprites
    def objpal(p):
        return [0] + [pack555(c) for c in p]

    obj_palettes = [None] * 8
    obj_palettes[0] = objpal(kpal)  # Kathy P1
    # P2: cambia el azul (0,162,255) por un rojo, placeholder
    blue5 = c5((0, 162, 255))
    red5 = c5((255, 72, 64))
    obj_palettes[1] = objpal([red5 if c == blue5 else c for c in kpal])
    obj_palettes[2] = objpal(epal)
    obj_palettes[3] = objpal(bpal)
    # 4,5,6: versiones "dano" (las genera el juego); 7: portal
    if ppal is not None:
        obj_palettes[7] = objpal(ppal)
    for i in range(8):
        if obj_palettes[i] is None:
            obj_palettes[i] = [0, 0, 0, 0]

    bg_palettes = [[pack555(c) for c in p] for p in pals]
    bg_palettes.append([pack555(c) for c in coin_pal])  # 6: moneda
    bg_palettes.append([pack555(c) for c in [(2, 3, 5), (15, 20, 25), (22, 25, 29), (31, 31, 31)]])  # 7: HUD

    out["bgPalettes"] = bg_palettes
    out["objPalettes"] = obj_palettes
    out["bgTiles"] = [enc_tile(t) for t in bg_pool.tiles] + [coin_bytes]
    out["objTiles"] = [enc_tile(t) for t in obj_pool.tiles]
    out["map"] = {"w": gw, "h": gh, "tiles": tile_map, "attrs": attr_map}
    out["solid"] = solid
    out["coinTile"] = coin_tile_id
    out["coinPalette"] = 6
    out["hudPalette"] = 7
    out["kathy"] = kathy_frames
    out["enemy"] = enemy_frames
    out["bullet"] = bullet_frame
    out["portal"] = portal_frames
    out["bulletCenter"] = bullet_center
    out["muzzle"] = muzzle
    out["stats"] = {
        "bgTiles": len(out["bgTiles"]),
        "objTiles": len(out["objTiles"]),
        "kathyTiles": n_kathy_tiles,
    }

    with open(os.path.join(ROOT, "assets.js"), "w") as f:
        f.write("// GENERADO por tools/convert.py - no editar a mano\n")
        f.write("window.ASSETS = " + json.dumps(out, separators=(",", ":")) + ";\n")

    # ------------------------------------------------------------- previews
    # mapa tras ajuste
    img = Image.fromarray(np.array([[c8(tuple(p)) for p in row] for row in new_img], dtype=np.uint8))
    img.save(os.path.join(PREVIEW, "map_gbc.png"))
    # diff
    diff = Image.fromarray(m.copy())
    dr = ImageDraw.Draw(diff)
    for x, y, d in changed:
        dr.rectangle([x * 8, y * 8, x * 8 + 7, y * 8 + 7], outline=(255, 0, 255))
    for x, y, n in over:
        dr.rectangle([x * 8, y * 8, x * 8 + 7, y * 8 + 7], outline=(255, 255, 0))
    diff.resize((mw * 3, mh * 3), Image.NEAREST).save(os.path.join(PREVIEW, "map_diff.png"))
    col = Image.fromarray(m.copy()).convert("RGBA")
    ov = Image.new("RGBA", col.size, (0, 0, 0, 0))
    od = ImageDraw.Draw(ov)
    for i, s in enumerate(solid):
        if s:
            x, y = (i % gw) * 8, (i // gw) * 8
            od.rectangle([x, y, x + 7, y + 7], fill=(255, 0, 0, 110))
    Image.alpha_composite(col, ov).convert("RGB").resize((mw * 3, mh * 3), Image.NEAREST).save(
        os.path.join(PREVIEW, "collision.png"))

    # tileset con ids (usa la paleta de la primera aparicion)
    first_pal = {}
    for i, t in enumerate(tile_map):
        first_pal.setdefault(t, attr_map[i] & 7)
    n = len(bg_pool.tiles)
    cols = 12
    rows = (n + cols - 1) // cols
    S = 4
    sheet = Image.new("RGB", (cols * 10 * S, rows * 10 * S), (40, 40, 40))
    sd = ImageDraw.Draw(sheet)
    for tid, t in enumerate(bg_pool.tiles):
        pal = pals[first_pal.get(tid, 0)]
        timg = Image.new("RGB", (8, 8))
        timg.putdata([c8(pal[v]) for v in t.reshape(-1)])
        ox, oy = (tid % cols) * 10 * S + S, (tid // cols) * 10 * S + S
        sheet.paste(timg.resize((8 * S, 8 * S), Image.NEAREST), (ox, oy))
        sd.text((ox + 1, oy + 1), str(tid), fill=(255, 255, 255))
    sheet.save(os.path.join(PREVIEW, "tileset_ids.png"))

    with open(os.path.join(PREVIEW, "report.txt"), "w") as f:
        f.write("\n".join(LOG) + "\n")
    log("")
    log(f"VRAM: BG {len(out['bgTiles'])}/256 tiles (banco 0), OBJ {len(out['objTiles'])}/256 tiles (banco 1)")
    log("Hecho: assets.js y preview/ generados.")


if __name__ == "__main__":
    main()
