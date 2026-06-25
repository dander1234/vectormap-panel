// search.ts — local (query-data) address search for the search box.
//
// Pure function: given the marker layers, the panel's data frames, and a query
// string, return the rows whose configured address field contains the query.
// This runs in memory (no network), so the search box can match as you type and
// only falls back to the external geocoder on demand.

import { DataFrame } from '@grafana/data';
import { MarkerLayerConfig } from './types';

// Common field names used to auto-detect coordinates when a layer doesn't name
// them explicitly (mirrors the marker builder's behavior).
const LAT_NAMES = ['latitude', 'lat', 'y'];
const LNG_NAMES = ['longitude', 'long', 'lng', 'lon', 'x'];

// A picked search result. 'local' comes from query data (and carries the row's
// attributes for a rich popup); 'web' comes from the external geocoder.
export type SearchHit =
  | {
      source: 'local';
      layerId: string;
      layerName: string;
      label: string; // the matched address text
      lng: number;
      lat: number;
      props: Record<string, unknown>;
    }
  | {
      source: 'web';
      label: string;
      lng: number;
      lat: number;
      bbox?: [number, number, number, number];
    };

// Find a field by explicit name, else by a list of common fallback names.
const findField = (frame: DataFrame, explicit: string, fallbacks: string[]) =>
  explicit
    ? frame.fields.find((f) => f.name === explicit)
    : frame.fields.find((f) => fallbacks.includes(f.name.toLowerCase()));

// Search the marker layers' address fields for `query` (case-insensitive
// substring). Only layers with an `addressField` set participate; each layer is
// restricted to its bound query (`refId`) when set. Stops at `max` hits.
export const localAddressSearch = (
  layers: MarkerLayerConfig[],
  series: DataFrame[],
  query: string,
  max: number
): SearchHit[] => {
  const q = query.trim().toLowerCase();
  if (!q) {
    return [];
  }
  const hits: SearchHit[] = [];
  for (const layer of layers) {
    if (!layer.addressField) {
      continue; // this layer opts out of local address search
    }
    const frames = layer.refId ? series.filter((f) => f.refId === layer.refId) : series;
    for (const frame of frames) {
      const addrField = frame.fields.find((f) => f.name === layer.addressField);
      const latField = findField(frame, layer.latField, LAT_NAMES);
      const lngField = findField(frame, layer.lngField, LNG_NAMES);
      if (!addrField || !latField || !lngField) {
        continue;
      }
      for (let i = 0; i < frame.length; i++) {
        const raw = addrField.values[i];
        if (raw === null || raw === undefined) {
          continue;
        }
        const text = String(raw);
        if (!text.toLowerCase().includes(q)) {
          continue;
        }
        const lat = Number(latField.values[i]);
        const lng = Number(lngField.values[i]);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          continue;
        }
        const props: Record<string, unknown> = {};
        for (const f of frame.fields) {
          props[f.name] = f.values[i];
        }
        hits.push({ source: 'local', layerId: layer.id, layerName: layer.name, label: text, lng, lat, props });
        if (hits.length >= max) {
          return hits;
        }
      }
    }
  }
  return hits;
};
