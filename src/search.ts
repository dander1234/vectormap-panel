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

// Which configured field a local hit matched (shown as a tag in the dropdown).
export type LocalMatchKind = 'address' | 'account' | 'equipment';

// A picked search result. 'local' comes from query data (and carries the row's
// attributes for a rich popup); 'web' comes from the external geocoder.
export type SearchHit =
  | {
      source: 'local';
      layerId: string;
      layerName: string;
      kind: LocalMatchKind; // which field matched (address / account / equipment)
      label: string; // the matched value
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

// The per-layer config keys that are searchable, with the kind tag each produces.
const SEARCHABLE: Array<{ key: 'addressField' | 'accountIdField' | 'equipmentIdField'; kind: LocalMatchKind }> = [
  { key: 'addressField', kind: 'address' },
  { key: 'accountIdField', kind: 'account' },
  { key: 'equipmentIdField', kind: 'equipment' },
];

// Find a field by explicit name, else by a list of common fallback names.
const findField = (frame: DataFrame, explicit: string, fallbacks: string[]) =>
  explicit
    ? frame.fields.find((f) => f.name === explicit)
    : frame.fields.find((f) => fallbacks.includes(f.name.toLowerCase()));

// Search the marker layers' configured search fields (address + account/equipment
// IDs) for `query` (case-insensitive substring). Only layers with at least one of
// those fields set participate; each layer is restricted to its bound query
// (`refId`) when set. Stops at `max` hits.
export const localFeatureSearch = (
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
    // Which of this layer's fields are searchable (set), with their kind tags.
    const searchable = SEARCHABLE.map((s) => ({ kind: s.kind, name: layer[s.key] })).filter((s) => s.name);
    if (searchable.length === 0) {
      continue; // this layer opts out of search
    }
    const frames = layer.refId ? series.filter((f) => f.refId === layer.refId) : series;
    for (const frame of frames) {
      const latField = findField(frame, layer.latField, LAT_NAMES);
      const lngField = findField(frame, layer.lngField, LNG_NAMES);
      // Resolve each searchable name to a field object in this frame.
      const resolved = searchable
        .map((s) => ({ kind: s.kind, field: frame.fields.find((f) => f.name === s.name) }))
        .filter((r): r is { kind: LocalMatchKind; field: NonNullable<typeof r.field> } => !!r.field);
      if (!latField || !lngField || resolved.length === 0) {
        continue;
      }
      for (let i = 0; i < frame.length; i++) {
        // First searchable field whose value contains the query wins for this row
        // (so a row shows once, tagged by the field that matched).
        let match: { kind: LocalMatchKind; label: string } | null = null;
        for (const r of resolved) {
          const raw = r.field.values[i];
          if (raw === null || raw === undefined) {
            continue;
          }
          const text = String(raw);
          if (text.toLowerCase().includes(q)) {
            match = { kind: r.kind, label: text };
            break;
          }
        }
        if (!match) {
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
        hits.push({
          source: 'local',
          layerId: layer.id,
          layerName: layer.name,
          kind: match.kind,
          label: match.label,
          lng,
          lat,
          props,
        });
        if (hits.length >= max) {
          return hits;
        }
      }
    }
  }
  return hits;
};
