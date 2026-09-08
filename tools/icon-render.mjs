import zlib from 'node:zlib';

/**
 * A tiny signed-distance-field rasteriser and PNG encoder.
 *
 * The extension needs real icons at four sizes and has no image dependencies,
 * so the mark is drawn mathematically: distance fields give clean antialiasing
 * at every size, including the unforgiving 16px favicon.
 */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed), 0);
  return Buffer.concat([length, typed, crc]);
}

/** Encode straight RGBA bytes as a PNG. */
export function encodePng(rgba, size) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;   // bit depth
  header[9] = 6;   // colour type: RGBA
  header[10] = 0;  // deflate
  header[11] = 0;  // adaptive filtering
  header[12] = 0;  // no interlace

  // Each scanline is prefixed with its filter type; 0 means "none".
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const clamp01 = (value) => Math.min(1, Math.max(0, value));

/** Smooth 0..1 transition, used to antialias a distance field. */
function smoothstep(edge0, edge1, x) {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function roundedBoxDistance(px, py, cx, cy, halfW, halfH, radius) {
  const qx = Math.abs(px - cx) - (halfW - radius);
  const qy = Math.abs(py - cy) - (halfH - radius);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return outside + Math.min(Math.max(qx, qy), 0) - radius;
}

function segmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : clamp01(((px - ax) * dx + (py - ay) * dy) / lengthSq);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Build the polyline for a dollar sign: two 210-degree arcs forming the S,
 * plus the vertical bar that runs through them.
 */
export function dollarPath(cx, cy, height) {
  const r = height / 4;
  const points = [];
  const arc = (centerY, fromDeg, toDeg) => {
    const steps = 48;
    for (let i = 0; i <= steps; i += 1) {
      const deg = fromDeg + ((toDeg - fromDeg) * i) / steps;
      const rad = (deg * Math.PI) / 180;
      points.push([cx + r * Math.cos(rad), centerY + r * Math.sin(rad), i === 0]);
    }
  };

  // Upper bowl: from the upper-right terminal, over the top, down to the waist.
  arc(cy - r, 300, 90);
  // Lower bowl: from the waist, out to the right, round to the lower-left terminal.
  arc(cy + r, 270, 480);

  const segments = [];
  for (let i = 1; i < points.length; i += 1) {
    if (points[i][2]) continue; // do not join the end of one arc to the start of the next
    segments.push([points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]]);
  }

  const overshoot = height * 0.12;
  segments.push([cx, cy - height / 2 - overshoot, cx, cy + height / 2 + overshoot]);
  return segments;
}

const BG_TOP = [79, 70, 229];    // indigo
const BG_BOTTOM = [13, 148, 136]; // teal

/** Render the Price Per Dollar mark at `size` pixels square. */
export function renderIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const aa = 1.0;

  const glyphHeight = size * 0.56;
  // Thin strokes disappear at 16px, so the stroke thickens as the canvas shrinks.
  const strokeRatio = size <= 20 ? 0.24 : size <= 40 ? 0.2 : 0.17;
  const strokeWidth = glyphHeight * strokeRatio;
  const segments = dollarPath(size / 2, size / 2, glyphHeight);
  const cornerRadius = size * 0.22;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;

      const boxDistance = roundedBoxDistance(px, py, size / 2, size / 2, size / 2, size / 2, cornerRadius);
      const boxAlpha = smoothstep(aa / 2, -aa / 2, boxDistance);

      const mix = py / size;
      let r = BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * mix;
      let g = BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * mix;
      let b = BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * mix;

      let glyphDistance = Infinity;
      for (const [ax, ay, bx, by] of segments) {
        const distance = segmentDistance(px, py, ax, ay, bx, by);
        if (distance < glyphDistance) glyphDistance = distance;
      }
      const glyphAlpha = smoothstep(aa / 2, -aa / 2, glyphDistance - strokeWidth / 2);

      r = r + (255 - r) * glyphAlpha;
      g = g + (255 - g) * glyphAlpha;
      b = b + (255 - b) * glyphAlpha;

      const offset = (y * size + x) * 4;
      rgba[offset] = Math.round(r);
      rgba[offset + 1] = Math.round(g);
      rgba[offset + 2] = Math.round(b);
      rgba[offset + 3] = Math.round(boxAlpha * 255);
    }
  }
  return rgba;
}

/** ASCII preview, used to eyeball the mark without opening a file. */
export function previewIcon(size) {
  const rgba = renderIcon(size);
  const ramp = ' .:-=+*#%@';
  const lines = [];
  for (let y = 0; y < size; y += 1) {
    let line = '';
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      const alpha = rgba[offset + 3] / 255;
      const luma = (0.2126 * rgba[offset] + 0.7152 * rgba[offset + 1] + 0.0722 * rgba[offset + 2]) / 255;
      const value = alpha === 0 ? 0 : luma;
      line += ramp[Math.min(ramp.length - 1, Math.round(value * (ramp.length - 1)))];
    }
    lines.push(line);
  }
  return lines.join('\n');
}
