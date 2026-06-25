// geocode.ts — external address lookup for the search box.
//
// Pure-ish module: a single `geocode()` entry point that calls either Nominatim
// (OpenStreetMap's free geocoder) or a user-configured custom endpoint, plus a
// tolerant `parseGeocodeResults` that turns either common response shape (a
// GeoJSON FeatureCollection, or a Nominatim-style array) into our GeocodeResult.
//
// Nominatim usage policy: keep volume low (we only call on an explicit action,
// not per keystroke), limit results, and attribute OpenStreetMap. See
// https://operations.osmfoundation.org/policies/nominatim/

// Which external geocoder the search box uses. 'none' = local-only (no web call).
export type GeocoderKind = 'nominatim' | 'custom' | 'none';

// One geocoded location.
export interface GeocodeResult {
  label: string; // human-readable address/name
  lng: number;
  lat: number;
  // Optional result bounds [west, south, east, north] for fitBounds.
  bbox?: [number, number, number, number];
}

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=0&limit=5&q={query}';

const num = (v: unknown): number => Number(v);
const isFiniteNum = (v: unknown): v is number => Number.isFinite(Number(v));

// Parse a geocoder response into results. Accepts:
//  1. GeoJSON FeatureCollection of Point features (Pelias/Photon/Mapbox-style);
//     label from properties.display_name | label | name, else the first string.
//  2. A Nominatim-style array of { lat, lon, display_name, boundingbox? }.
export const parseGeocodeResults = (json: unknown): GeocodeResult[] => {
  const out: GeocodeResult[] = [];

  // Case 1: GeoJSON FeatureCollection.
  if (json && typeof json === 'object' && (json as any).type === 'FeatureCollection') {
    for (const f of (json as any).features ?? []) {
      const geom = f?.geometry;
      if (!geom || geom.type !== 'Point' || !Array.isArray(geom.coordinates)) {
        continue;
      }
      const [lng, lat] = geom.coordinates;
      if (!isFiniteNum(lng) || !isFiniteNum(lat)) {
        continue;
      }
      const p = f.properties ?? {};
      const label =
        p.display_name ?? p.label ?? p.name ?? Object.values(p).find((v) => typeof v === 'string') ?? `${lat}, ${lng}`;
      const bb = Array.isArray(f.bbox) && f.bbox.length === 4 ? (f.bbox as [number, number, number, number]) : undefined;
      out.push({ label: String(label), lng: num(lng), lat: num(lat), bbox: bb });
    }
    return out;
  }

  // Case 2: Nominatim-style array.
  if (Array.isArray(json)) {
    for (const r of json) {
      const lat = r?.lat;
      const lng = r?.lon ?? r?.lng;
      if (!isFiniteNum(lat) || !isFiniteNum(lng)) {
        continue;
      }
      // Nominatim boundingbox is [south, north, west, east] as strings.
      let bbox: [number, number, number, number] | undefined;
      const bb = r?.boundingbox;
      if (Array.isArray(bb) && bb.length === 4 && bb.every(isFiniteNum)) {
        bbox = [num(bb[2]), num(bb[0]), num(bb[3]), num(bb[1])]; // -> [west, south, east, north]
      }
      out.push({ label: String(r?.display_name ?? r?.name ?? `${lat}, ${lng}`), lat: num(lat), lng: num(lng), bbox });
    }
  }
  return out;
};

// Build the request URL. The custom template must contain {query}; we also run it
// through `interpolate` so Grafana dashboard variables (e.g. an API key) resolve.
const buildUrl = (kind: GeocoderKind, template: string, query: string, interpolate: (s: string) => string): string => {
  const base = kind === 'nominatim' ? NOMINATIM_URL : template;
  const withQuery = base.replace('{query}', encodeURIComponent(query));
  return interpolate(withQuery);
};

export interface GeocodeOptions {
  url: string; // custom URL template (used when kind === 'custom')
  interpolate: (s: string) => string; // Grafana replaceVariables (identity if none)
}

// Geocode `query`. Returns [] for 'none', a blank query, or a missing custom URL.
// Throws on network/HTTP errors (the caller shows a message). `signal` lets the
// caller cancel a stale in-flight request.
export const geocode = async (
  kind: GeocoderKind,
  query: string,
  opts: GeocodeOptions,
  signal?: AbortSignal
): Promise<GeocodeResult[]> => {
  const q = query.trim();
  if (kind === 'none' || !q) {
    return [];
  }
  if (kind === 'custom' && !opts.url.trim()) {
    return [];
  }
  const url = buildUrl(kind, opts.url, q, opts.interpolate);
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`Geocoder returned HTTP ${res.status}`);
  }
  return parseGeocodeResults(await res.json());
};
