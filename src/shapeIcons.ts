// shapeIcons.ts — generate marker shape icons for MapLibre symbol layers.
//
// MapLibre has no shape primitive beyond `circle`. To draw squares / triangles /
// diamonds / stars / crosses / hexagons we register IMAGES with the map and draw
// them via a `symbol` layer's `icon-image`.
//
// We generate each shape as an **SDF** (signed distance field) image. Why SDF and
// not a plain colored PNG?
//   - SDF icons are RECOLORABLE at runtime via the paint property `icon-color`.
//     That lets a shaped marker take its color from data (the same per-feature
//     `__color` we compute for circles) AND lets us recolor it on highlight —
//     none of which is possible with a pre-baked colored bitmap.
//   - SDF stays crisp at any size (the shader reconstructs the edge from the
//     distance field), so one icon per shape works for every marker radius.
//
// The SDF generation here is a compact port of Mapbox's "TinySDF" (the same
// technique MapLibre uses for text glyphs): rasterize the shape to an alpha mask,
// run a Euclidean distance transform inside and outside the shape, and pack the
// signed distance into the image's alpha channel.

import maplibregl from 'maplibre-gl';
import { MarkerShape } from './types';

// Shapes offered in the editor (circle is handled by a native circle layer, so
// it's the implicit default and not strictly an "icon", but we list it for the
// dropdown). Order is the dropdown order.
export const MARKER_SHAPES: MarkerShape[] = ['circle', 'square', 'triangle', 'diamond', 'star', 'cross', 'hexagon'];

// --- Icon geometry constants -------------------------------------------------
// The icon canvas is SIZE×SIZE; the shape is drawn inside, leaving BUFFER px of
// padding on every side (the SDF needs room around the shape for the distance
// field, and the halo/outline needs a little bleed space too). EFFECTIVE is the
// shape's actual span in image pixels — the panel scales icon-size against it so
// a marker "radius" maps to the same pixel size a circle of that radius would be.
const SIZE = 48;
const BUFFER = 6;
export const SHAPE_ICON_EFFECTIVE = SIZE - BUFFER * 2; // 36

// SDF encoding params (TinySDF defaults). RADIUS is the distance range in px that
// gets mapped across the alpha channel; CUTOFF positions the edge within it.
const RADIUS = 8;
const CUTOFF = 0.25;

// MapLibre image id for a shape's SDF (shared across all layers using that shape).
export const iconIdForShape = (shape: MarkerShape): string => `vmshape-${shape}`;

// Register a shape's SDF image on the map once (no-op if already present). Safe to
// call on every render; guarded by hasImage. 'circle' has no icon (native layer).
export const ensureShapeIcon = (map: maplibregl.Map, shape: MarkerShape): void => {
  if (shape === 'circle') {
    return;
  }
  const id = iconIdForShape(shape);
  if (map.hasImage(id)) {
    return;
  }
  const img = makeShapeSDF(shape);
  if (img) {
    // sdf:true tells MapLibre the alpha channel is a distance field, enabling
    // icon-color / icon-halo recoloring.
    map.addImage(id, img, { sdf: true, pixelRatio: 1 });
  }
};

// --- Shape rasterization -----------------------------------------------------
// Trace a shape's outline (centered, radius r) onto the 2D context as a path.
const tracePath = (ctx: CanvasRenderingContext2D, shape: MarkerShape, cx: number, cy: number, r: number): void => {
  ctx.beginPath();
  switch (shape) {
    case 'square': {
      ctx.rect(cx - r, cy - r, r * 2, r * 2);
      break;
    }
    case 'triangle': {
      // Equilateral, point up. Vertices at -90°, 30°, 150°.
      polygon(ctx, cx, cy, r, 3, -Math.PI / 2);
      break;
    }
    case 'diamond': {
      // Square rotated 45° (points up/right/down/left).
      polygon(ctx, cx, cy, r, 4, -Math.PI / 2);
      break;
    }
    case 'hexagon': {
      polygon(ctx, cx, cy, r, 6, -Math.PI / 2);
      break;
    }
    case 'star': {
      star(ctx, cx, cy, r, r * 0.45, 5, -Math.PI / 2);
      break;
    }
    case 'cross': {
      // A plus sign: a vertical and a horizontal bar (arm thickness = r).
      const t = r * 0.5; // half arm thickness
      ctx.rect(cx - t, cy - r, t * 2, r * 2);
      ctx.rect(cx - r, cy - t, r * 2, t * 2);
      break;
    }
    default:
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
  }
  ctx.closePath();
};

// Regular n-gon path (vertices on a circle of radius r, first vertex at startAngle).
const polygon = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  n: number,
  startAngle: number
): void => {
  for (let i = 0; i < n; i++) {
    const a = startAngle + (i * 2 * Math.PI) / n;
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
};

// k-pointed star path alternating outer radius rOuter and inner radius rInner.
const star = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  points: number,
  startAngle: number
): void => {
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? rOuter : rInner;
    const a = startAngle + (i * Math.PI) / points;
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
};

// Rasterize a shape and convert it to an RGBA SDF image (alpha = distance field,
// RGB white). Returns null if a 2D canvas isn't available.
const makeShapeSDF = (shape: MarkerShape): { width: number; height: number; data: Uint8ClampedArray } | null => {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return null;
  }
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = '#ffffff';
  tracePath(ctx, shape, SIZE / 2, SIZE / 2, SHAPE_ICON_EFFECTIVE / 2);
  ctx.fill();

  const alpha = ctx.getImageData(0, 0, SIZE, SIZE).data; // RGBA; we read .a

  // Distance transform buffers (squared distances), sized to the largest dim.
  const n = SIZE * SIZE;
  const gridOuter = new Float64Array(n);
  const gridInner = new Float64Array(n);
  const INF = 1e20;
  for (let i = 0; i < n; i++) {
    const a = alpha[i * 4 + 3] / 255; // coverage 0..1
    gridOuter[i] = a === 1 ? 0 : a === 0 ? INF : Math.pow(Math.max(0, 0.5 - a), 2);
    gridInner[i] = a === 1 ? INF : a === 0 ? 0 : Math.pow(Math.max(0, a - 0.5), 2);
  }
  const f = new Float64Array(SIZE);
  const d = new Float64Array(SIZE);
  const v = new Int16Array(SIZE);
  const z = new Float64Array(SIZE + 1);
  edt(gridOuter, SIZE, SIZE, f, d, v, z);
  edt(gridInner, SIZE, SIZE, f, d, v, z);

  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const dist = Math.sqrt(gridOuter[i]) - Math.sqrt(gridInner[i]); // signed: >0 outside
    const val = Math.round(255 - 255 * (dist / RADIUS + CUTOFF));
    out[i * 4] = 255;
    out[i * 4 + 1] = 255;
    out[i * 4 + 2] = 255;
    out[i * 4 + 3] = val < 0 ? 0 : val > 255 ? 255 : val;
  }
  return { width: SIZE, height: SIZE, data: out };
};

// --- Euclidean distance transform (Felzenszwalb & Huttenlocher) --------------
// Computes the squared 2D distance transform in place: two passes of the 1D
// transform (columns then rows). `data` holds squared distances throughout.
const edt = (
  data: Float64Array,
  width: number,
  height: number,
  f: Float64Array,
  d: Float64Array,
  v: Int16Array,
  z: Float64Array
): void => {
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      f[y] = data[y * width + x];
    }
    edt1d(f, d, v, z, height);
    for (let y = 0; y < height; y++) {
      data[y * width + x] = d[y];
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      f[x] = data[y * width + x];
    }
    edt1d(f, d, v, z, width);
    for (let x = 0; x < width; x++) {
      data[y * width + x] = d[x];
    }
  }
};

// 1D squared distance transform of an array f, result in d. v/z are scratch
// buffers (lower-envelope vertices and intersection boundaries).
const edt1d = (f: Float64Array, d: Float64Array, v: Int16Array, z: Float64Array, n: number): void => {
  v[0] = 0;
  z[0] = -1e20;
  z[1] = 1e20;
  for (let q = 1, k = 0; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = 1e20;
  }
  for (let q = 0, k = 0; q < n; q++) {
    while (z[k + 1] < q) {
      k++;
    }
    const r = v[k];
    d[q] = (q - r) * (q - r) + f[r];
  }
};
