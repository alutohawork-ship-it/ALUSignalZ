// lib/chart-render.js — Renderer candlestick PNG murni JS (node:zlib), tanpa dependency native.
// 1 gambar = 3 panel bertumpuk (HTF/MTF/LTF) + gridline harga ber-label + zona + kolam likuiditas.
import zlib from 'node:zlib';

const CRC_T = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c; } return t; })();
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePNG(w, h, px) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  let o = 0;
  for (let y = 0; y < h; y++) { raw[o++] = 0; px.copy(raw, o, y * w * 4, (y + 1) * w * 4); o += w * 4; }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Font bitmap 5x7 (bit 0x10 = kolom paling kiri)
const F = {
  '0': [0x0E,0x11,0x13,0x15,0x19,0x11,0x0E], '1': [0x04,0x0C,0x04,0x04,0x04,0x04,0x0E],
  '2': [0x0E,0x11,0x01,0x02,0x04,0x08,0x1F], '3': [0x1F,0x02,0x04,0x02,0x01,0x11,0x0E],
  '4': [0x02,0x06,0x0A,0x12,0x1F,0x02,0x02], '5': [0x1F,0x10,0x1E,0x01,0x01,0x11,0x0E],
  '6': [0x06,0x08,0x10,0x1E,0x11,0x11,0x0E], '7': [0x1F,0x01,0x02,0x04,0x08,0x08,0x08],
  '8': [0x0E,0x11,0x11,0x0E,0x11,0x11,0x0E], '9': [0x0E,0x11,0x11,0x0F,0x01,0x02,0x0C],
  'A': [0x0E,0x11,0x11,0x1F,0x11,0x11,0x11], 'B': [0x1E,0x11,0x11,0x1E,0x11,0x11,0x1E],
  'C': [0x0E,0x11,0x10,0x10,0x10,0x11,0x0E], 'D': [0x1E,0x11,0x11,0x11,0x11,0x11,0x1E],
  'E': [0x1F,0x10,0x10,0x1E,0x10,0x10,0x1F], 'F': [0x1F,0x10,0x10,0x1E,0x10,0x10,0x10],
  'G': [0x0E,0x11,0x10,0x17,0x11,0x11,0x0F], 'H': [0x11,0x11,0x11,0x1F,0x11,0x11,0x11],
  'I': [0x0E,0x04,0x04,0x04,0x04,0x04,0x0E], 'J': [0x07,0x02,0x02,0x02,0x02,0x12,0x0C],
  'K': [0x11,0x12,0x14,0x18,0x14,0x12,0x11], 'L': [0x10,0x10,0x10,0x10,0x10,0x10,0x1F],
  'M': [0x11,0x1B,0x15,0x15,0x11,0x11,0x11], 'N': [0x11,0x11,0x19,0x15,0x13,0x11,0x11],
  'O': [0x0E,0x11,0x11,0x11,0x11,0x11,0x0E], 'P': [0x1E,0x11,0x11,0x1E,0x10,0x10,0x10],
  'Q': [0x0E,0x11,0x11,0x11,0x15,0x12,0x0D], 'R': [0x1E,0x11,0x11,0x1E,0x14,0x12,0x11],
  'S': [0x0F,0x10,0x10,0x0E,0x01,0x01,0x1E], 'T': [0x1F,0x04,0x04,0x04,0x04,0x04,0x04],
  'U': [0x11,0x11,0x11,0x11,0x11,0x11,0x0E], 'V': [0x11,0x11,0x11,0x11,0x11,0x0A,0x04],
  'W': [0x11,0x11,0x11,0x15,0x15,0x1B,0x11], 'X': [0x11,0x11,0x0A,0x04,0x0A,0x11,0x11],
  'Y': [0x11,0x11,0x0A,0x04,0x04,0x04,0x04], 'Z': [0x1F,0x01,0x02,0x04,0x08,0x10,0x1F],
  ' ': [0,0,0,0,0,0,0], '.': [0,0,0,0,0,0x0C,0x0C], '-': [0,0,0,0x1F,0,0,0],
  ':': [0,0x0C,0x0C,0,0x0C,0x0C,0], '%': [0x13,0x13,0x02,0x04,0x08,0x13,0x13],
  '+': [0,0x04,0x04,0x1F,0x04,0x04,0], '/': [0x01,0x02,0x02,0x04,0x08,0x08,0x10],
  '(': [0x02,0x04,0x08,0x08,0x08,0x04,0x02], ')': [0x08,0x04,0x02,0x02,0x02,0x04,0x08],
};

const BG = [11, 15, 20], BULL = [38, 166, 154], BEAR = [239, 83, 80];
const GRID = [30, 38, 48], TXT = [159, 176, 192], LIVE = [255, 213, 79], POOL = [255, 183, 77];
const ZD = [16, 42, 40], ZS = [52, 26, 28], ZDB = [38, 166, 154], ZSB = [239, 83, 80];

export function renderSignalChart({ dec = 2, live = 0, panels = [] }) {
  const W = 880, AXIS = 100, LEFT = 8, PH = 236, GAP = 10;
  const H = GAP + panels.length * (PH + GAP);
  const px = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) { px[i * 4] = BG[0]; px[i * 4 + 1] = BG[1]; px[i * 4 + 2] = BG[2]; px[i * 4 + 3] = 255; }
  const set = (x, y, c) => { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= W || y >= H) return; const o = (y * W + x) * 4; px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; };
  const rect = (x0, y0, x1, y1, c) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, c); };
  const hline = (y, c, dash) => { for (let x = 0; x < W - AXIS; x++) { if (dash && (x % 8) > 4) continue; set(LEFT + x, y, c); } };
  const vline = (x, y0, y1, c) => { for (let y = y0; y <= y1; y++) set(x, y, c); };
  const text = (x, y, str, c, sc = 2) => {
    let cx = x;
    for (const ch of String(str).toUpperCase()) {
      const g = F[ch] || F[' '];
      for (let r = 0; r < 7; r++) for (let b = 0; b < 5; b++) if (g[r] & (0x10 >> b)) rect(cx + b * sc, y + r * sc, cx + b * sc + sc - 1, y + r * sc + sc - 1, c);
      cx += 6 * sc;
    }
  };

  panels.forEach((pn, idx) => {
    const y0 = GAP + idx * (PH + GAP);
    text(LEFT + 4, y0 + 4, pn.label || '', TXT, 2);
    const rows = pn.rows || [];
    if (!rows.length) { text(LEFT + 4, y0 + 40, 'NO DATA', TXT, 2); return; }
    let mn = Infinity, mx = -Infinity;
    for (const c of rows) { if (c.l < mn) mn = c.l; if (c.h > mx) mx = c.h; }
    const pad = (mx - mn) * 0.07 || 1; mn -= pad; mx += pad;
    const yOf = p => y0 + PH - ((p - mn) / (mx - mn)) * PH;
    for (let i = 0; i <= 4; i++) {
      const pr = mn + (mx - mn) * (i / 4), y = yOf(pr);
      hline(y, GRID, false);
      text(W - AXIS + 6, y - 7, pr.toFixed(dec), TXT, 2);
    }
    for (const z of (pn.zones || [])) {
      const yA = yOf(z.hi), yB = yOf(z.lo);
      rect(LEFT, yA, W - AXIS - 1, yB, z.side === 'demand' ? ZD : ZS);
      hline(yA, z.side === 'demand' ? ZDB : ZSB, true); hline(yB, z.side === 'demand' ? ZDB : ZSB, true);
    }
    for (const pl of (pn.pools || [])) {
      if (pl.price < mn || pl.price > mx) continue;
      const y = yOf(pl.price);
      hline(y, POOL, true);
      text(LEFT + 4, y - 12, pl.label || '', POOL, 2);
    }
    const n = rows.length, cw = (W - AXIS - LEFT) / n, bw = Math.max(2, Math.floor(cw * 0.6));
    rows.forEach((c, i) => {
      const x = LEFT + i * cw + cw / 2, col = c.c >= c.o ? BULL : BEAR;
      vline(x, yOf(c.h), yOf(c.l), col);
      const yA = yOf(Math.max(c.o, c.c)), yB = yOf(Math.min(c.o, c.c));
      rect(x - bw / 2, yA, x + bw / 2, Math.max(yB, yA + 1), col);
    });
    if (live > mn && live < mx) {
      const y = yOf(live);
      hline(y, LIVE, true);
      text(W - AXIS + 6, y - 7, live.toFixed(dec), LIVE, 2);
    }
  });

  const png = encodePNG(W, H, px);
  return 'data:image/png;base64,' + png.toString('base64');
}
