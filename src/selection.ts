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
// Feature-state highlight target
// ---------------------------------------------------------------------------

// A map.setFeatureState identity for one feature (markers have no sourceLayer).
export interface HighlightTarget {
  source: string;
  sourceLayer?: string;
  id: string | number;
}

// A loose shape for the one feature returned by a single-point queryRenderedFeatures.
export interface ClickedFeature {
  id?: string | number;
  source?: string;
  sourceLayer?: string;
}

// Decide the feature-state highlight target for a clicked feature, or null when
// it can't be highlighted. Highlighting is keyed on a feature id: marker (GeoJSON)
// sources get one from generateId, but GeoServer/MVT tiles frequently ship
// features with NO id, so f.id is undefined. Returning null in that case lets the
// caller STILL show the tooltip (properties are present — that's why the same
// tiles render attributes in OpenLayers) while skipping the highlight. Keeping
// this pure makes the "tooltip works even without an id" contract unit-testable.
export const highlightTargetFor = (f: ClickedFeature | undefined | null): HighlightTarget | null => {
  if (!f || f.id === undefined || f.id === null) {
    return null;
  }
  const target: HighlightTarget = { source: f.source ?? '', id: f.id };
  if (f.sourceLayer) {
    target.sourceLayer = f.sourceLayer;
  }
  return target;
};

// ---------------------------------------------------------------------------
// Selection geometry — the "polygon seam"
// ---------------------------------------------------------------------------

// What the user drew, expressed in SCREEN (pixel) space ready for MapLibre's
// queryRenderedFeatures. 'box' = a rectangle, 'polygon' = a closed lasso, 'line' =
// an OPEN polyline (straight two-point or freehand trace) that selects features it
// crosses or passes near.
export type SelectionGeometry =
  | { kind: 'box'; p1: [number, number]; p2: [number, number] } // two opposite corner pixels
  | { kind: 'polygon'; points: Array<[number, number]> } // closed lasso outline
  | { kind: 'line'; points: Array<[number, number]> }; // open polyline

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

// --- Line (open polyline) select tests, all in SCREEN/pixel space ------------

// Distance from point p to segment ab (pixels).
const distPointToSegment = (p: Pt, a: Pt, b: Pt): number => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = a[0] + t * dx;
  const cy = a[1] + t * dy;
  return Math.hypot(p[0] - cx, p[1] - cy);
};

// Is point pt within `buffer` px of the open polyline `line`?
const pointNearLine = (pt: Pt, line: Pt[], buffer: number): boolean => {
  for (let i = 0; i < line.length - 1; i++) {
    if (distPointToSegment(pt, line[i], line[i + 1]) <= buffer) {
      return true;
    }
  }
  return false;
};

// Any vertex of `pts` within `buffer` px of the line?
const anyVertexNearLine = (pts: Pt[], line: Pt[], buffer: number): boolean =>
  pts.some((p) => pointNearLine(p, line, buffer));

// Does any segment of `pts` cross any (open) segment of `line`? `closed` adds the
// closing segment of `pts` (for polygon rings).
const segmentsCrossPath = (pts: Pt[], line: Pt[], closed = false): boolean => {
  const n = pts.length;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    for (let j = 0; j < line.length - 1; j++) {
      if (segmentsIntersect(a, b, line[j], line[j + 1])) {
        return true;
      }
    }
  }
  return false;
};

// Does this feature interact with the drawn line? Points match within `buffer` px;
// lines/polygons match if any segment crosses the line or a vertex is near it.
export const featureNearLine = (
  geometry: { type: string; coordinates: any },
  line: Pt[],
  project: (coord: Pt) => Pt,
  buffer: number
): boolean => {
  const testLine = (coords: Pt[]): boolean => {
    const pts = coords.map(project);
    return anyVertexNearLine(pts, line, buffer) || segmentsCrossPath(pts, line);
  };
  const testPolygon = (rings: Pt[][]): boolean => {
    const outer = (rings[0] ?? []).map(project);
    return anyVertexNearLine(outer, line, buffer) || segmentsCrossPath(outer, line, true);
  };
  switch (geometry.type) {
    case 'Point':
      return pointNearLine(project(geometry.coordinates as Pt), line, buffer);
    case 'MultiPoint':
      return (geometry.coordinates as Pt[]).some((c) => pointNearLine(project(c), line, buffer));
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
export const dedupeKeyFor = (feature: RenderedFeature, filter: FieldFilterConfig): string => {
  if (feature.id !== undefined && feature.id !== null) {
    return `id:${String(feature.id)} ${feature.sourceLayer ?? ''}`;
  }
  const { title, entries } = selectTooltipFields(feature.properties ?? {}, filter);
  return `props:${title ?? ''} ${JSON.stringify(entries)}`;
};

// The bounding box (pixel space) of a set of points, for a first-pass
// queryRenderedFeatures before refining to the exact polygon/line.
const bboxOf = (points: Pt[]): [Pt, Pt] => {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return [
    [Math.min(...xs), Math.min(...ys)],
    [Math.max(...xs), Math.max(...ys)],
  ];
};

// Pixels within which a point feature counts as "on" a drawn line.
const LINE_SELECT_BUFFER_PX = 6;

// Run a selection: query the drawn geometry across the target layers, drop tile
// duplicates, group by layer, and cap each group. Pure aside from reading the
// map's currently-rendered features.
export const runSelectionQuery = (params: QueryParams): SelectionResult => {
  const { map, geometry, targets, maxPerLayer } = params;
  const layerIds = targets.map((t) => t.mapLayerId);

  // No selectable+visible layers → nothing to do.
  if (layerIds.length === 0) {
    return { groups: [], totalCount: 0, cappedAny: false };
  }

  const project = (coord: Pt): Pt => {
    const p = map.project(coord as any);
    return [p.x, p.y];
  };

  // Query the rendered features inside the shape. A box queries its pixel bbox
  // directly. A lasso/line queries the bounding box first (all MapLibre can do
  // natively) then refines by testing each candidate's projected geometry, so
  // lines/plant segments passing through are included — not just points.
  let raw: RenderedFeature[] = [];
  if (geometry.kind === 'box') {
    raw = map.queryRenderedFeatures([geometry.p1, geometry.p2], { layers: layerIds }) as unknown as RenderedFeature[];
  } else if (geometry.kind === 'polygon') {
    const lasso = geometry.points;
    if (lasso.length < 3) {
      return { groups: [], totalCount: 0, cappedAny: false }; // not a polygon
    }
    const candidates = map.queryRenderedFeatures(bboxOf(lasso), { layers: layerIds }) as unknown as RenderedFeature[];
    raw = candidates.filter((f) => f.geometry && featureInLasso(f.geometry, lasso, project));
  } else {
    const line = geometry.points;
    if (line.length < 2) {
      return { groups: [], totalCount: 0, cappedAny: false }; // not a line
    }
    const candidates = map.queryRenderedFeatures(bboxOf(line), { layers: layerIds }) as unknown as RenderedFeature[];
    raw = candidates.filter((f) => f.geometry && featureNearLine(f.geometry, line, project, LINE_SELECT_BUFFER_PX));
  }

  return buildSelectionResult(raw, targets, maxPerLayer);
};

// Group a raw list of rendered features (from a shape query OR accumulated by the
// click-select tool) into the display result: de-dup per layer, cap, and keep
// target order. The single source of truth for the SelectionResult shape.
export const buildSelectionResult = (
  raw: RenderedFeature[],
  targets: SelectionTarget[],
  maxPerLayer: number
): SelectionResult => {
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

// The header + string rows for one layer group (shared by the CSV/text/HTML
// exporters). Newlines in a cell are collapsed to spaces so they never break a
// row.
const groupRows = (group: SelectedLayerGroup): { header: string[]; rows: string[][] } => {
  const { titleHeader, keys } = columnsFor(group);
  const header = [...(titleHeader ? [titleHeader] : []), ...keys];
  const rows = group.features.map((f) => {
    const { title, entries } = selectTooltipFields(f.props, group.filter);
    const map = new Map(entries);
    const cells = [...(titleHeader ? [title ?? ''] : []), ...keys.map((k) => (map.has(k) ? map.get(k) : ''))];
    return cells.map((c) => String(c ?? '').replace(/[\r\n]+/g, ' '));
  });
  return { header, rows };
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

// Aligned plain-text tables (one per layer) for pasting into a chat/email that
// renders in a monospace font — also a valid Markdown table, so Markdown-aware
// targets show a real grid. Columns are padded to their widest cell.
export const selectionToPlainTable = (result: SelectionResult): string => {
  const pad = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - s.length));
  const sections: string[] = [];
  for (const group of result.groups) {
    const { header, rows } = groupRows(group);
    const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
    const line = (cells: string[]) => `| ${cells.map((c, i) => pad(c, widths[i])).join(' | ')} |`;
    const sep = `| ${widths.map((w) => '-'.repeat(w)).join(' | ')} |`;
    const body = rows.map(line).join('\n');
    sections.push(`${group.layerName} (${group.features.length})\n${line(header)}\n${sep}${body ? '\n' + body : ''}`);
  }
  return sections.join('\n\n');
};

// Rich HTML tables (one per layer) for pasting into email or a rich chat, which
// render as real grids. Inline styles so they survive paste into Outlook/Gmail.
export const selectionToHtmlTable = (result: SelectionResult): string => {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const td = 'style="border:1px solid #999;padding:4px 8px;text-align:left"';
  const parts: string[] = [];
  for (const group of result.groups) {
    const { header, rows } = groupRows(group);
    const head = `<tr>${header.map((h) => `<th ${td}>${esc(h)}</th>`).join('')}</tr>`;
    const body = rows
      .map((r) => `<tr>${header.map((_, i) => `<td ${td}>${esc(r[i] ?? '')}</td>`).join('')}</tr>`)
      .join('');
    parts.push(
      `<p style="font-family:sans-serif"><b>${esc(group.layerName)}</b> (${group.features.length})</p>` +
        `<table style="border-collapse:collapse;font-family:sans-serif;font-size:13px"><thead>${head}</thead><tbody>${body}</tbody></table>`
    );
  }
  return parts.join('<br>');
};
