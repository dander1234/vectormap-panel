// selection.ts — the "Select area" feature's pure (non-React) core.
//
// This file has NO React and NO direct dependency on the panel component. It
// holds:
//   1. small shared helpers (compileRegex / isEmptyValue) that used to live in
//      VectormapPanel.tsx,
//   2. `selectTooltipFields` — the ONE place that decides which feature
//      attributes to show (used by BOTH the click popup and the selection
//      drawer, so they always agree),
//   3. the selection pipeline: turn a drawn shape + a list of target layers into
//      a de-duplicated, grouped list of features (`runSelectionQuery`),
//   4. a CSV exporter for those results (`selectionToCsv`).
//
// Keeping these as plain functions makes them easy to unit-test (see
// selection.test.ts) and keeps the React component focused on the map.

// We only need MapLibre's *types* here (not the runtime), so import the type.
import type maplibregl from 'maplibre-gl';
import { TooltipLink } from './types';

// ---------------------------------------------------------------------------
// Shared field helpers (moved out of VectormapPanel so popup + drawer share them)
// ---------------------------------------------------------------------------

// Compile a user-supplied regex, returning null on blank/invalid input so a bad
// pattern can never throw — it simply means "no filter".
export const compileRegex = (src: string): RegExp | null => {
  if (!src || !src.trim()) {
    return null;
  }
  try {
    return new RegExp(src, 'i'); // case-insensitive, matches the tooltip behavior
  } catch {
    return null;
  }
};

// A value counts as "empty" when it's null/undefined or blank after trimming.
export const isEmptyValue = (v: unknown): boolean => v === null || v === undefined || String(v).trim() === '';

// The subset of a layer's tooltip config that controls WHICH fields are shown.
// (The popup also carries colors/links, but those don't affect field selection.)
export interface FieldFilterConfig {
  hideEmpty: boolean; // drop null/blank-valued attributes
  include: string; // case-insensitive regex on field NAME; '' = all fields
  exclude: string; // case-insensitive regex on field NAME to hide; '' = none
  titleField: string; // field pulled out as a header (and removed from the rows)
}

// The result of filtering a feature's properties: an optional resolved title
// plus the remaining [key, value] entries, in original order, title removed.
export interface SelectedFields {
  title: string | null;
  entries: Array<[string, unknown]>;
}

// Decide which of a feature's properties to display, applying the same rules the
// click popup uses: skip internal `__` keys, optionally drop empties, apply the
// include/exclude name regexes, then lift the title field out of the rows.
//
// This is the single source of truth shared by buildPropsTable (popup) and the
// selection drawer/CSV, so a layer's tooltip config controls both consistently.
export const selectTooltipFields = (props: Record<string, unknown>, cfg: FieldFilterConfig): SelectedFields => {
  const includeRe = compileRegex(cfg.include);
  const excludeRe = compileRegex(cfg.exclude);

  let entries = Object.entries(props).filter(([key, value]) => {
    if (key.startsWith('__')) {
      return false; // internal props (e.g. __color/__radius on markers)
    }
    if (cfg.hideEmpty && isEmptyValue(value)) {
      return false;
    }
    if (includeRe && !includeRe.test(key)) {
      return false;
    }
    if (excludeRe && excludeRe.test(key)) {
      return false;
    }
    return true;
  });

  let title: string | null = null;
  if (cfg.titleField) {
    const titleValue = props[cfg.titleField];
    if (!isEmptyValue(titleValue)) {
      title = String(titleValue);
      entries = entries.filter(([key]) => key !== cfg.titleField); // don't repeat it in the rows
    }
  }

  return { title, entries };
};

// ---------------------------------------------------------------------------
// Selection geometry — the "polygon seam"
// ---------------------------------------------------------------------------

// What the user drew, expressed in SCREEN (pixel) space ready for MapLibre's
// queryRenderedFeatures. Only 'box' is produced today; 'polygon' is reserved so
// a future freehand mode can feed the exact same pipeline below (it would query
// the polygon's bounding box then point-in-polygon filter — see runSelectionQuery).
export type SelectionGeometry =
  | { kind: 'box'; p1: [number, number]; p2: [number, number] } // two opposite corner pixels
  | { kind: 'polygon'; points: Array<[number, number]> }; // RESERVED for a later polygon mode

// ---------------------------------------------------------------------------
// Query results
// ---------------------------------------------------------------------------

// One selected feature, normalized for display + highlight.
export interface SelectedFeature {
  dedupeKey: string; // stable key used to drop tile duplicates
  props: Record<string, unknown>; // raw feature.properties (filtered at render time)
  // Identity for map.setFeatureState highlighting (markers have no sourceLayer).
  source: string;
  sourceLayer?: string;
  id?: string | number;
}

// All selected features for ONE layer, plus the display metadata the drawer needs.
export interface SelectedLayerGroup {
  layerId: string; // the config id (NOT the MapLibre layer id)
  layerName: string;
  isMarker: boolean;
  filter: FieldFilterConfig; // this layer's field filter (drives the table columns)
  links: TooltipLink[]; // this layer's templated links (rendered in the results table)
  features: SelectedFeature[]; // capped to maxPerLayer
  totalBeforeCap: number; // how many matched before the cap (for "showing N of M")
}

export interface SelectionResult {
  groups: SelectedLayerGroup[]; // only layers that matched ≥1 feature, in target order
  totalCount: number; // sum of shown features across groups (after cap)
  cappedAny: boolean; // true if any group hit the cap
}

// One layer the panel wants the selection to query. The panel builds these from
// the layers that are both `selectable` and currently visible, mapping each to
// its MapLibre layer id and its tooltip field filter.
export interface SelectionTarget {
  mapLayerId: string; // e.g. 'vt-layer-abc' / 'mk-layer-xyz' (what queryRenderedFeatures uses)
  layerId: string; // config id
  layerName: string;
  isMarker: boolean;
  filter: FieldFilterConfig;
  links: TooltipLink[];
}

export interface QueryParams {
  map: maplibregl.Map;
  geometry: SelectionGeometry;
  targets: SelectionTarget[];
  maxPerLayer: number; // cap per layer to protect the drawer/CSV from huge selections
}

// A loose shape for the features MapLibre returns (it types them as GeoJSON
// features with extra runtime fields we read here). `geometry` is the rendered
// geometry in lng/lat, used by the lasso (polygon) test.
type RenderedFeature = {
  layer?: { id?: string };
  properties?: Record<string, unknown> | null;
  id?: string | number;
  source?: string;
  sourceLayer?: string;
  geometry?: { type: string; coordinates: any };
};

// --- Lasso (polygon) geometry tests, all in SCREEN/pixel space ---------------
// We project each feature coordinate to pixels (via the map) and test it against
// the lasso polygon, so points, lines (plant segments), and fills are all handled
// consistently regardless of map projection.

type Pt = [number, number];

// Ray-casting point-in-polygon test.
const pointInPolygon = (pt: Pt, poly: Pt[]): boolean => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    const intersect = yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi;
    if (intersect) {
      inside = !inside;
    }
  }
  return inside;
};

// Orientation-based test: do segments AB and CD cross?
const segmentsIntersect = (a: Pt, b: Pt, c: Pt, d: Pt): boolean => {
  const ccw = (p: Pt, q: Pt, r: Pt) => (r[1] - p[1]) * (q[0] - p[0]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = ccw(c, d, a);
  const d2 = ccw(c, d, b);
  const d3 = ccw(a, b, c);
  const d4 = ccw(a, b, d);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
};

// True if any vertex of `pts` is inside the lasso.
const anyVertexInside = (pts: Pt[], lasso: Pt[]): boolean => pts.some((p) => pointInPolygon(p, lasso));

// True if any segment of `pts` crosses any edge of the lasso. `closed` adds the
// segment from the last point back to the first (for polygon rings).
const anyEdgeCrosses = (pts: Pt[], lasso: Pt[], closed: boolean): boolean => {
  const n = pts.length;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    for (let j = 0, k = lasso.length - 1; j < lasso.length; k = j++) {
      if (segmentsIntersect(a, b, lasso[k], lasso[j])) {
        return true;
      }
    }
  }
  return false;
};

// Does this feature interact with the lasso polygon? Points must be inside; lines
// and polygons count if any vertex is inside OR any edge crosses the lasso (and a
// fully-enclosed lasso inside a big polygon also counts).
const featureInLasso = (
  geometry: { type: string; coordinates: any },
  lasso: Pt[],
  project: (coord: Pt) => Pt
): boolean => {
  const testLine = (coords: Pt[]): boolean => {
    const pts = coords.map(project);
    return anyVertexInside(pts, lasso) || anyEdgeCrosses(pts, lasso, false);
  };
  const testPolygon = (rings: Pt[][]): boolean => {
    const outer = (rings[0] ?? []).map(project);
    return anyVertexInside(outer, lasso) || anyEdgeCrosses(outer, lasso, true) || pointInPolygon(lasso[0], outer);
  };
  switch (geometry.type) {
    case 'Point':
      return pointInPolygon(project(geometry.coordinates as Pt), lasso);
    case 'MultiPoint':
      return (geometry.coordinates as Pt[]).some((c) => pointInPolygon(project(c), lasso));
    case 'LineString':
      return testLine(geometry.coordinates as Pt[]);
    case 'MultiLineString':
      return (geometry.coordinates as Pt[][]).some(testLine);
    case 'Polygon':
      return testPolygon(geometry.coordinates as Pt[][]);
    case 'MultiPolygon':
      return (geometry.coordinates as Pt[][][]).some(testPolygon);
    default:
      return false;
  }
};

// Compute the de-dup key for one feature within a layer. Vector tiles return the
// SAME feature once per covering tile, so we must collapse those. When the
// feature has a real id we key on it (+ sourceLayer); otherwise we fall back to a
// stable key derived from the displayed fields. NOTE: the fallback can merge two
// genuinely distinct features that share identical displayed attributes —
// promoting an id in the tile (or setting promoteId) is the robust fix; the
// drawer surfaces this caveat in its hint.
const dedupeKeyFor = (feature: RenderedFeature, filter: FieldFilterConfig): string => {
  if (feature.id !== undefined && feature.id !== null) {
    return `id:${String(feature.id)} ${feature.sourceLayer ?? ''}`;
  }
  const { title, entries } = selectTooltipFields(feature.properties ?? {}, filter);
  return `props:${title ?? ''} ${JSON.stringify(entries)}`;
};

// Run a selection: query the drawn geometry across the target layers, drop tile
// duplicates, group by layer, and cap each group. Pure aside from reading the
// map's currently-rendered features.
export const runSelectionQuery = (params: QueryParams): SelectionResult => {
  const { map, geometry, targets, maxPerLayer } = params;

  // Map each MapLibre layer id back to its target so we can group + filter.
  const byMapLayerId = new Map<string, SelectionTarget>();
  for (const t of targets) {
    byMapLayerId.set(t.mapLayerId, t);
  }
  const layerIds = targets.map((t) => t.mapLayerId);

  // No selectable+visible layers → nothing to do.
  if (layerIds.length === 0) {
    return { groups: [], totalCount: 0, cappedAny: false };
  }

  // Query the rendered features inside the shape. A box queries its pixel bbox
  // directly. A lasso (polygon) queries the polygon's bounding box first — that's
  // all MapLibre can do natively — then refines to the polygon by testing each
  // candidate's projected geometry against it (so lines/plant segments that pass
  // through the lasso are included, not just points).
  let raw: RenderedFeature[] = [];
  if (geometry.kind === 'box') {
    raw = map.queryRenderedFeatures([geometry.p1, geometry.p2], { layers: layerIds }) as unknown as RenderedFeature[];
  } else {
    const lasso = geometry.points;
    if (lasso.length < 3) {
      return { groups: [], totalCount: 0, cappedAny: false }; // not a polygon
    }
    const xs = lasso.map((p) => p[0]);
    const ys = lasso.map((p) => p[1]);
    const bbox: [Pt, Pt] = [
      [Math.min(...xs), Math.min(...ys)],
      [Math.max(...xs), Math.max(...ys)],
    ];
    const candidates = map.queryRenderedFeatures(bbox, { layers: layerIds }) as unknown as RenderedFeature[];
    const project = (coord: Pt): Pt => {
      const p = map.project(coord as any);
      return [p.x, p.y];
    };
    raw = candidates.filter((f) => f.geometry && featureInLasso(f.geometry, lasso, project));
  }

  // Accumulate per target, preserving target order for the output groups.
  const acc = new Map<string, { target: SelectionTarget; seen: Set<string>; features: SelectedFeature[]; total: number }>();
  for (const t of targets) {
    acc.set(t.mapLayerId, { target: t, seen: new Set(), features: [], total: 0 });
  }

  for (const feature of raw) {
    const mapLayerId = feature.layer?.id ?? '';
    const bucket = acc.get(mapLayerId);
    if (!bucket) {
      continue; // a layer we didn't ask for (shouldn't happen given the filter)
    }
    const key = dedupeKeyFor(feature, bucket.target.filter);
    if (bucket.seen.has(key)) {
      continue; // duplicate tile copy of an already-seen feature
    }
    bucket.seen.add(key);
    bucket.total += 1;
    if (bucket.features.length < maxPerLayer) {
      const sel: SelectedFeature = {
        dedupeKey: key,
        props: feature.properties ?? {},
        source: feature.source ?? '',
      };
      if (feature.sourceLayer) {
        sel.sourceLayer = feature.sourceLayer;
      }
      if (feature.id !== undefined && feature.id !== null) {
        sel.id = feature.id;
      }
      bucket.features.push(sel);
    }
  }

  const groups: SelectedLayerGroup[] = [];
  let totalCount = 0;
  let cappedAny = false;
  for (const t of targets) {
    const bucket = acc.get(t.mapLayerId)!;
    if (bucket.features.length === 0) {
      continue; // omit layers with no hits; totalCount===0 → drawer shows "0 selected"
    }
    if (bucket.total > bucket.features.length) {
      cappedAny = true;
    }
    totalCount += bucket.features.length;
    groups.push({
      layerId: t.layerId,
      layerName: t.layerName,
      isMarker: t.isMarker,
      filter: t.filter,
      links: t.links,
      features: bucket.features,
      totalBeforeCap: bucket.total,
    });
  }

  return { groups, totalCount, cappedAny };
};

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

// Quote a single CSV cell per RFC 4180: wrap in double quotes and double any
// internal quotes when the value contains a comma, quote, or newline.
const csvCell = (value: unknown): string => {
  const s = String(value ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// Build the ordered column list for one layer group: the title field first (if
// the layer uses one), then the union of every displayed attribute key across
// the group's features, in first-seen order. This keeps sparse rows aligned.
const columnsFor = (group: SelectedLayerGroup): { titleHeader: string | null; keys: string[] } => {
  const keys: string[] = [];
  const seen = new Set<string>();
  let usesTitle = false;
  for (const f of group.features) {
    const { title, entries } = selectTooltipFields(f.props, group.filter);
    if (title !== null) {
      usesTitle = true;
    }
    for (const [k] of entries) {
      if (!seen.has(k)) {
        seen.add(k);
        keys.push(k);
      }
    }
  }
  return { titleHeader: usesTitle ? group.filter.titleField || 'title' : null, keys };
};

// Export the whole selection as CSV. Because layers have different columns, we
// emit one section per layer: a "# <name> (<count>)" comment line, a header row,
// then one row per feature. Sections are separated by a blank line.
export const selectionToCsv = (result: SelectionResult): string => {
  const sections: string[] = [];
  for (const group of result.groups) {
    const { titleHeader, keys } = columnsFor(group);
    const header = [...(titleHeader ? [titleHeader] : []), ...keys];
    const lines: string[] = [];
    lines.push(`# ${group.layerName} (${group.features.length})`);
    lines.push(header.map(csvCell).join(','));
    for (const f of group.features) {
      const { title, entries } = selectTooltipFields(f.props, group.filter);
      const map = new Map(entries);
      const row = [...(titleHeader ? [title ?? ''] : []), ...keys.map((k) => (map.has(k) ? map.get(k) : ''))];
      lines.push(row.map(csvCell).join(','));
    }
    sections.push(lines.join('\n'));
  }
  return sections.join('\n\n');
};
