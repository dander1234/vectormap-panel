// measure.ts — pure distance helpers for the ruler / measurement tool.
//
// No map or DOM dependency, so the math is unit-tested directly. Points are
// [lng, lat] in WGS84 degrees (MapLibre's order).

type LngLat = [number, number];

const EARTH_RADIUS_M = 6371008.8; // mean Earth radius (meters)
const M_PER_FT = 0.3048;
const FT_PER_MI = 5280;

// Great-circle (haversine) distance between two [lng,lat] points, in meters.
export const haversineMeters = (a: LngLat, b: LngLat): number => {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
};

// Total length of a polyline (sum of segment haversine distances), in meters.
// 0 or 1 point → 0.
export const pathLengthMeters = (points: LngLat[]): number => {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineMeters(points[i - 1], points[i]);
  }
  return total;
};

// Group digits with thousands separators (no locale dependency in tests).
const withCommas = (n: number): string => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

// Format a distance (meters) in BOTH imperial and metric, e.g.
//   "1,240 ft (378 m)"   and past ~1000 ft / 1 km   "2.71 mi (4.36 km)".
export const formatDistanceBoth = (meters: number): string => {
  const feet = meters / M_PER_FT;
  const imperial = feet >= FT_PER_MI ? `${(feet / FT_PER_MI).toFixed(2)} mi` : `${withCommas(Math.round(feet))} ft`;
  const metric = meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${withCommas(Math.round(meters))} m`;
  return `${imperial} (${metric})`;
};
