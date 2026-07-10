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
import { iconById } from './icons';

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
// An unknown id falls back to the square silhouette so a marker never vanishes.
export const ensureShapeIcon = (map: maplibregl.Map, shape: MarkerShape): void => {
  if (shape === 'circle') {
    return;
  }
  const id = iconIdForShape(shape);
  if (map.hasImage(id)) {
    return;
  }
  const icon = iconById(shape) ?? iconById('square');
  if (!icon) {
    return;
  }
  const img = makeIconSDF(icon.path, icon.fillRule ?? 'nonzero');
  if (img) {
    // sdf:true tells MapLibre the alpha channel is a distance field, enabling
    // icon-color / icon-halo recoloring.
    map.addImage(id, img, { sdf: true, pixelRatio: 1 });
  }
};

// --- Icon rasterization ------------------------------------------------------
// Rasterize a registry icon's SVG path (authored in a 24×24 box) to an RGBA SDF
// image (alpha = distance field, RGB white). The path is scaled to the shape's
// EFFECTIVE span and centered in the SIZE canvas via a transform. Returns null if
// a 2D canvas isn't available (e.g. server-side / tests — the map only runs in the
// browser). `Path2D` accepts SVG path data directly.
const makeIconSDF = (
  svgPath: string,
  fillRule: 'nonzero' | 'evenodd'
): { width: number; height: number; data: Uint8ClampedArray } | null => {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx || typeof Path2D === 'undefined') {
    return null;
  }
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = '#ffffff';
  // Map the 24-unit viewBox onto the EFFECTIVE span, offset by BUFFER so it's
  // centered with room for the distance field.
  ctx.save();
  ctx.translate(BUFFER, BUFFER);
  ctx.scale(SHAPE_ICON_EFFECTIVE / 24, SHAPE_ICON_EFFECTIVE / 24);
  ctx.fill(new Path2D(svgPath), fillRule);
  ctx.restore();

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
