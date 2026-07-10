// VectormapPanel — the React component that renders the MapLibre GL JS map.
//
// Bridges React (declarative DOM) and MapLibre (imperative map object) using
// `useRef` (a stable box surviving re-renders) and `useEffect` (side effects at
// controlled lifecycle points). Each effect below is numbered and commented.

import React, { useEffect, useRef, useState } from 'react';
import { PanelProps, GrafanaTheme2, DataFrame } from '@grafana/data';
import { Button, RadioButtonGroup, useStyles2, useTheme2 } from '@grafana/ui';
import { css } from '@emotion/css';
import maplibregl from 'maplibre-gl';
import {
  VectormapOptions,
  BasemapKind,
  VectorTileLayerConfig,
  MarkerLayerConfig,
  MarkerColorMode,
  TooltipLink,
} from '../types';
import { LayerControl, ControlLayer, LegendShape } from './LayerControl';
import { SelectionResults } from './SelectionResults';
import { SearchBox } from './SearchBox';
import { BasemapControl } from './BasemapControl';
import { geocode, GeocodeResult } from '../geocode';
import { localFeatureSearch, SearchHit } from '../search';
import { ensureShapeIcon, iconIdForShape, SHAPE_ICON_EFFECTIVE } from '../shapeIcons';
import { MAPLIBRE_CSS } from '../maplibreCss';
import {
  selectTooltipFields,
  runSelectionQuery,
  buildSelectionResult,
  dedupeKeyFor,
  highlightTargetFor,
  SelectionGeometry,
  SelectionResult,
  SelectionTarget,
  FieldFilterConfig,
} from '../selection';
import { fillUrl, sanitizeUrl } from '../links';
import { pathLengthMeters, formatDistanceBoth } from '../measure';
import { MeasureReadout } from './MeasureReadout';

// The selection tools offered in the toolbar.
type SelectTool = 'box' | 'lasso' | 'line' | 'trace' | 'click';

// MapLibre's stylesheet (positions the canvas, controls, and popups). Grafana
// plugin code rules forbid importing stylesheet files directly, so instead of a
// direct stylesheet import we keep the rules as a string (see maplibreCss) and
// inject them through emotion's css(), scoped to the map shell element below.
// Emotion rewrites each `.maplibregl-*` rule to `.<shell> .maplibregl-*`, so the
// styles apply only inside this panel's map (no global leakage) — every MapLibre
// element (canvas, controls, attribution, popups) lives inside the shell, so
// descendant scoping covers them all.
const mapShellClass = css(MAPLIBRE_CSS);

// Each configured layer becomes a MapLibre source + draw layer, derived from the
// layer's stable id. Prefixes let us find "our" overlays vs the basemap.
const VT_SOURCE_PREFIX = 'vt-src-';
const VT_LAYER_PREFIX = 'vt-layer-';
const sourceIdFor = (layerId: string) => VT_SOURCE_PREFIX + layerId;
const layerIdFor = (layerId: string) => VT_LAYER_PREFIX + layerId;

// The basemap is managed as one swappable raster source + layer kept beneath the
// overlays (so changing it never disturbs the overlay layers).
const BASEMAP_SOURCE_ID = 'basemap';
const BASEMAP_LAYER_ID = 'basemap';

// Each marker layer (built from the panel's query data) becomes its own GeoJSON
// source + circle layer, derived from the marker layer's stable id, kept on top
// of the vector tile overlays.
const MK_SOURCE_PREFIX = 'mk-src-';
const MK_LAYER_PREFIX = 'mk-layer-';
// Text-label layer for a marker layer (a separate symbol layer over the dot).
// DISTINCT prefix (not mk-layer-) so it's excluded from click/selection
// hit-testing — clicks fall through to the dot underneath.
const MK_LABEL_PREFIX = 'mk-label-';
const mkSourceIdFor = (id: string) => MK_SOURCE_PREFIX + id;
const mkLayerIdFor = (id: string) => MK_LAYER_PREFIX + id;
const mkLabelIdFor = (id: string) => MK_LABEL_PREFIX + id;

// line-dasharray patterns (in line-width units) for each tile line style. 'solid'
// omits the property. 'dotted'/'dashdot' rely on the round line-cap for the dots.
const LINE_DASH: Record<string, number[] | undefined> = {
  solid: undefined,
  dashed: [2, 2],
  dotted: [0, 2],
  dashdot: [3, 1.5, 0, 1.5],
};

// Default glyph (font) endpoint — MapLibre's font server, which serves Noto Sans
// in Regular/Bold/Italic. Used when the panel's glyphsUrl option is blank.
// (fonts.openmaptiles.org was retired to an HTML landing page — do not use it.)
const DEFAULT_GLYPHS = 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf';

// Compose a MapLibre `text-font` stack from a family + style. Blank family →
// 'Noto Sans' (the default server's family). The resulting name (e.g.
// 'Noto Sans Bold') must be served by the active glyph endpoint or no text draws.
const STYLE_WORD: Record<string, string> = { regular: 'Regular', bold: 'Bold', italic: 'Italic' };
const labelFont = (family: string, style: string): [string] => {
  const fam = (family || 'Noto Sans').trim();
  return [`${fam} ${STYLE_WORD[style] ?? 'Regular'}`];
};
const LAT_NAMES = ['latitude', 'lat', 'y'];
const LNG_NAMES = ['longitude', 'long', 'lng', 'lon', 'x'];

// Color used to draw a clicked/selected feature.
const HIGHLIGHT_COLOR = '#00e5ff';

// The address-search result marker (a single GeoJSON point + ring layer kept on
// top of everything).
const SEARCH_PIN_SOURCE = 'search-pin';
const SEARCH_PIN_LAYER = 'search-pin';
// Measurement (ruler) draw layers — a geo-anchored line + its vertices.
const MEASURE_LINE_SRC = 'measure-line';
const MEASURE_LINE_LAYER = 'measure-line';
const MEASURE_PT_SRC = 'measure-pts';
const MEASURE_PT_LAYER = 'measure-pts';

// Paint expression: highlight value when the feature is selected, else normal.
// Returns `any` to sidestep MapLibre's strict expression typing.
const whenHighlighted = (highlightValue: unknown, normalValue: unknown): any => [
  'case',
  ['boolean', ['feature-state', 'highlighted'], false],
  highlightValue,
  normalValue,
];

// Raster source spec for a given basemap choice (null = no basemap). `any` keeps
// us out of MapLibre's source-spec typing; these are valid raster sources.
const basemapSourceSpec = (kind: BasemapKind, customUrl: string): any | null => {
  switch (kind) {
    case 'none':
      return null;
    case 'carto-light':
      return {
        type: 'raster',
        tileSize: 256,
        attribution: '© OpenStreetMap contributors, © CARTO',
        tiles: ['a', 'b', 'c'].map((s) => `https://${s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png`),
      };
    case 'carto-dark':
      return {
        type: 'raster',
        tileSize: 256,
        attribution: '© OpenStreetMap contributors, © CARTO',
        tiles: ['a', 'b', 'c'].map((s) => `https://${s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png`),
      };
    case 'satellite':
      // Esri World Imagery uses {z}/{y}/{x} order (note y before x).
      return {
        type: 'raster',
        tileSize: 256,
        attribution: 'Esri, Maxar, Earthstar Geographics',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      };
    case 'custom':
      return customUrl ? { type: 'raster', tileSize: 256, tiles: [customUrl] } : null;
    case 'osm':
    default:
      return {
        type: 'raster',
        tileSize: 256,
        attribution: '© OpenStreetMap contributors',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      };
  }
};

// Escape untrusted attribute text before inserting into popup HTML.
const escapeHtml = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// Resolved tooltip rendering config (from panel options + theme colors).
interface TooltipRenderConfig {
  hideEmpty: boolean;
  include: string;
  exclude: string;
  titleField: string;
  links: TooltipLink[];
  // Grafana's variable interpolator (from PanelProps) — applied to link URLs so
  // dashboard template variables resolve. Identity fn when unavailable.
  replaceVariables: (s: string) => string;
  keyColor: string;
  titleColor: string;
  mutedColor: string;
  linkColor: string;
}

// Build the popup HTML: an optional bold title + a filtered attribute table.
// Field selection (which attributes show, plus the title) is delegated to the
// shared selectTooltipFields helper so the click popup and the selection drawer
// always display the same fields for a given layer.
const buildPropsTable = (props: Record<string, unknown>, cfg: TooltipRenderConfig): string => {
  const { title, entries } = selectTooltipFields(props, {
    hideEmpty: cfg.hideEmpty,
    include: cfg.include,
    exclude: cfg.exclude,
    titleField: cfg.titleField,
  });

  const titleHtml =
    title !== null
      ? `<div style="font-weight:600;font-size:13px;margin-bottom:6px;color:${cfg.titleColor}">${escapeHtml(
          title
        )}</div>`
      : '';

  const rows = entries
    .map(
      ([key, value]) =>
        `<tr><td style="padding:2px 12px 2px 0;color:${cfg.keyColor};white-space:nowrap;vertical-align:top">${escapeHtml(
          key
        )}</td><td style="padding:2px 0;vertical-align:top">${escapeHtml(value)}</td></tr>`
    )
    .join('');
  const tableHtml = entries.length
    ? `<div style="max-height:260px;overflow:auto"><table style="border-collapse:collapse;font-size:12px;line-height:1.45">${rows}</table></div>`
    : '';

  // Links row: each template filled from this feature's attributes + dashboard
  // variables, then sanitized. Dropped if the result is empty/unsafe.
  const linkParts = (cfg.links ?? [])
    .map((lk) => {
      const url = sanitizeUrl(fillUrl(lk.url, props, cfg.replaceVariables));
      if (!url) {
        return '';
      }
      const target = lk.openInNewTab ? ' target="_blank" rel="noopener noreferrer"' : '';
      return `<a href="${escapeHtml(url)}"${target} style="color:${cfg.linkColor};text-decoration:underline">${escapeHtml(
        lk.label || url
      )}</a>`;
    })
    .filter(Boolean);
  const linksHtml = linkParts.length
    ? `<div style="margin-top:8px;padding-top:6px;border-top:1px solid ${cfg.mutedColor};font-size:12px;display:flex;flex-wrap:wrap;gap:4px 12px">${linkParts.join(
        ''
      )}</div>`
    : '';

  if (!titleHtml && !tableHtml && !linksHtml) {
    return `<div style="color:${cfg.mutedColor};font-size:12px">No attributes to show</div>`;
  }
  return `${titleHtml}${tableHtml}${linksHtml}`;
};

// Find a field by explicit name, else by a list of common fallback names.
const pickField = (frame: DataFrame, explicit: string, fallbacks: string[]) =>
  explicit
    ? frame.fields.find((f) => f.name === explicit)
    : frame.fields.find((f) => fallbacks.includes(f.name.toLowerCase()));

// Build a GeoJSON FeatureCollection of markers for ONE marker layer from the
// panel's data frames (works with any datasource — SQL, InfluxDB, …). The layer
// may be bound to a single query via `refId` (else every frame is read). Color
// follows the layer's color mode (fixed | field standard-config | explicit
// thresholds | explicit regex); size from a numeric field scaled into
// [size, sizeMax]. Each feature keeps all the row's values as properties (for the
// tooltip). Returns `any` to avoid the GeoJSON type imports — it's a valid
// FeatureCollection at runtime.
const buildMarkerFeatures = (series: DataFrame[], cfg: MarkerLayerConfig, resolveColor: (c: string) => string): any => {
  const features: any[] = [];
  const fixedColor = resolveColor(cfg.fixedColor || '#1f77b4');
  // Restrict to the bound query if one is set; otherwise read every frame.
  const frames = cfg.refId ? series.filter((f) => f.refId === cfg.refId) : series;

  // Resolve the color mode (older configs without colorMode behave like before:
  // 'field' if a color field is set, else 'fixed').
  const colorMode: MarkerColorMode = cfg.colorMode ?? (cfg.colorField ? 'field' : 'fixed');
  // Precompute the rule sets once (colors resolved here, not per row).
  // Thresholds: numeric, sorted ascending so the LAST one ≤ value wins.
  const thresholdRules =
    colorMode === 'thresholds'
      ? (cfg.colorRules ?? [])
          .map((r) => ({ t: Number(r.match), color: resolveColor(r.color) }))
          .filter((r) => Number.isFinite(r.t))
          .sort((a, b) => a.t - b.t)
      : [];
  // Regex: compiled case-insensitively; the FIRST match wins. Blank/invalid skipped.
  const regexRules =
    colorMode === 'regex'
      ? (cfg.colorRules ?? [])
          .map((r) => {
            if (!r.match.trim()) {
              return null;
            }
            try {
              return { re: new RegExp(r.match, 'i'), color: resolveColor(r.color) };
            } catch {
              return null;
            }
          })
          .filter((r): r is { re: RegExp; color: string } => r !== null)
      : [];

  for (const frame of frames) {
    const latField = pickField(frame, cfg.latField, LAT_NAMES);
    const lngField = pickField(frame, cfg.lngField, LNG_NAMES);
    if (!latField || !lngField) {
      continue;
    }
    const colorField = cfg.colorField ? frame.fields.find((f) => f.name === cfg.colorField) : undefined;
    const sizeField = cfg.sizeField ? frame.fields.find((f) => f.name === cfg.sizeField) : undefined;

    // Range of the size field, for linear scaling.
    let sMin = Infinity;
    let sMax = -Infinity;
    if (sizeField) {
      for (const v of sizeField.values) {
        const n = Number(v);
        if (Number.isFinite(n)) {
          sMin = Math.min(sMin, n);
          sMax = Math.max(sMax, n);
        }
      }
    }

    for (let i = 0; i < frame.length; i++) {
      const lat = Number(latField.values[i]);
      const lng = Number(lngField.values[i]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        continue;
      }
      // Color per the layer's mode; fixed/fallback color if nothing applies.
      let color = fixedColor;
      if (colorMode !== 'fixed' && colorField) {
        const raw = colorField.values[i];
        if (colorMode === 'field') {
          // Grafana standard config (value mappings / thresholds / scheme).
          const c = colorField.display ? colorField.display(raw).color : undefined;
          if (c) {
            color = c;
          }
        } else if (colorMode === 'thresholds') {
          const n = Number(raw);
          if (Number.isFinite(n)) {
            for (const r of thresholdRules) {
              if (n >= r.t) {
                color = r.color; // ascending, so the last match is the highest ≤ n
              }
            }
          }
        } else {
          // regex: first matching pattern wins.
          const s = String(raw ?? '');
          for (const r of regexRules) {
            if (r.re.test(s)) {
              color = r.color;
              break;
            }
          }
        }
      }
      // Size: scale the size field into [size, sizeMax], else fixed.
      let radius = cfg.size;
      if (sizeField && sMax > sMin) {
        const n = Number(sizeField.values[i]);
        const t = Number.isFinite(n) ? (n - sMin) / (sMax - sMin) : 0;
        radius = cfg.size + t * (cfg.sizeMax - cfg.size);
      }
      const properties: Record<string, unknown> = {};
      for (const f of frame.fields) {
        properties[f.name] = f.values[i];
      }
      properties.__color = color;
      properties.__radius = radius;
      features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties });
    }
  }
  return { type: 'FeatureCollection', features };
};

interface Props extends PanelProps<VectormapOptions> {}

export const VectormapPanel: React.FC<Props> = ({
  options,
  onOptionsChange,
  data,
  width,
  height,
  replaceVariables,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const theme = useTheme2();
  // Interactivity refs: the open attribute popup, and the highlighted feature.
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const highlightRef = useRef<{ source: string; sourceLayer?: string; id: string | number } | null>(null);
  // Theme-aware CSS class for the popup container (see getPopupStyles).
  const popupStyles = useStyles2(getPopupStyles);

  // The click handler is bound once (EFFECT 5), so it reads live data — the layer
  // configs (for per-layer tooltip rules), the themed popup class, and theme
  // colors — through this ref rather than a stale closure.
  const renderRef = useRef<{
    layers: VectorTileLayerConfig[];
    markerLayers: MarkerLayerConfig[];
    popupClass: string;
    keyColor: string;
    titleColor: string;
    mutedColor: string;
    linkColor: string;
    replaceVariables: (s: string) => string;
  }>({
    layers: [],
    markerLayers: [],
    popupClass: '',
    keyColor: '#888',
    titleColor: '#222',
    mutedColor: '#aaa',
    linkColor: '#3d71d9',
    replaceVariables: (s) => s,
  });
  useEffect(() => {
    renderRef.current = {
      layers: options.layers ?? [],
      markerLayers: options.markerLayers ?? [],
      popupClass: popupStyles.popup,
      keyColor: theme.colors.text.secondary,
      titleColor: theme.colors.text.primary,
      mutedColor: theme.colors.text.disabled,
      linkColor: theme.colors.text.link,
      replaceVariables: replaceVariables ?? ((s) => s),
    };
  }, [options.layers, options.markerLayers, popupStyles.popup, theme, replaceVariables]);

  // Runtime layer visibility (driven by the on-map LayerControl). Keyed by
  // layer.id. We also mirror it in a ref so the layer-build effect can read the
  // latest value even when it runs deferred (on the style 'load' event).
  // `visibility` holds only EXPLICIT runtime overrides (layer.id -> shown?). A
  // layer with no entry uses its configured `visible` default. Storing only
  // overrides means we never need an effect to sync it with the layer set.
  const [visibility, setVisibility] = useState<Record<string, boolean>>({});
  // Mirror it in a ref so EFFECT 4 (which may run deferred on 'load', and which
  // we don't want re-running on every toggle) can read the latest overrides
  // without taking `visibility` as a dependency. Updated in an effect, not during
  // render (mutating a ref during render is disallowed).
  const visibilityRef = useRef(visibility);
  useEffect(() => {
    visibilityRef.current = visibility;
  }, [visibility]);

  // Active "label view" per marker layer id ('' / missing = "Markers" = dot only).
  // Runtime-only UI state (not persisted), mirrored in a ref so EFFECT M can read
  // the live selection when it rebuilds without depending on it. Same pattern as
  // `visibility`/`visibilityRef` above.
  const [labelView, setLabelView] = useState<Record<string, string>>({});
  const labelViewRef = useRef(labelView);
  useEffect(() => {
    labelViewRef.current = labelView;
  }, [labelView]);

  // Viewer-selected basemap index (into options.basemapChoices). Runtime-only;
  // the first choice (index 0) is the default. Ignored when no choices exist.
  const [activeBasemapIdx, setActiveBasemapIdx] = useState(0);

  // --- "Select area" tool state -------------------------------------------
  // `selectMode` is the toolbar toggle (true while the user is in selection
  // mode). `selectModeRef` mirrors it so the once-bound click/drag handlers
  // (EFFECT 5/6) can read the live value without rebinding.
  const [selectMode, setSelectMode] = useState(false);
  const selectModeRef = useRef(false);
  useEffect(() => {
    selectModeRef.current = selectMode;
  }, [selectMode]);
  // Which selection tool is active: 'box' (drag a rectangle), 'lasso' (freehand
  // polygon), 'line' (straight two-point line), 'trace' (freehand open line), or
  // 'click' (pick features one at a time). Mirrored in a ref so the once-bound
  // EFFECT 5/6 read the live value.
  const [selectTool, setSelectTool] = useState<SelectTool>('box');
  const selectToolRef = useRef<SelectTool>('box');
  useEffect(() => {
    selectToolRef.current = selectTool;
  }, [selectTool]);
  // Accumulated features for the 'click' (pick) tool, keyed by dedupe key. Each
  // entry keeps the rendered feature + its target so we can rebuild the result.
  const clickSelectedRef = useRef<Map<string, { target: SelectionTarget; feature: any }>>(new Map());

  // --- Measurement (ruler) tool state -------------------------------------
  // Separate from selection; mutually exclusive with it. `measurePointsRef` holds
  // the committed [lng,lat] vertices; the readout shows the running total.
  const [measureMode, setMeasureMode] = useState(false);
  const measureModeRef = useRef(false);
  useEffect(() => {
    measureModeRef.current = measureMode;
  }, [measureMode]);
  const measurePointsRef = useRef<Array<[number, number]>>([]);
  const [measureMeters, setMeasureMeters] = useState(0);
  // The current selection results shown in the bottom drawer (null = drawer
  // closed). Populated by runSelection after a box is drawn.
  const [selection, setSelection] = useState<SelectionResult | null>(null);
  // The features we've highlighted for the current selection, so we can clear
  // their feature-state when the drawer closes or a new selection is made.
  const selectionHighlightRef = useRef<Array<{ source: string; sourceLayer?: string; id: string | number }>>([]);

  // Map a layer config (tile OR marker — both carry the same tooltip fields) to
  // the field-filter the selection drawer uses for its columns. This is what
  // makes the drawer reuse each layer's existing tooltip field configuration.
  const filterOf = (l: VectorTileLayerConfig | MarkerLayerConfig): FieldFilterConfig => ({
    hideEmpty: l.tooltipHideEmpty ?? true,
    include: l.tooltipInclude ?? '',
    exclude: l.tooltipExclude ?? '',
    titleField: l.tooltipTitleField ?? '',
  });

  // Turn off the highlight on every feature from the previous selection.
  const clearSelectionHighlight = () => {
    const map = mapRef.current;
    if (map) {
      for (const t of selectionHighlightRef.current) {
        map.setFeatureState(t, { highlighted: false });
      }
    }
    selectionHighlightRef.current = [];
  };

  // Highlight every selected feature that has an id (reusing the existing
  // feature-state 'highlighted' paint — no paint changes needed). Features
  // without an id can't be highlighted (documented limitation).
  const highlightSelected = (result: SelectionResult) => {
    const map = mapRef.current;
    if (!map) {
      return;
    }
    clearSelectionHighlight();
    const next: Array<{ source: string; sourceLayer?: string; id: string | number }> = [];
    for (const group of result.groups) {
      for (const f of group.features) {
        if (f.id === undefined) {
          continue;
        }
        const t: { source: string; sourceLayer?: string; id: string | number } = { source: f.source, id: f.id };
        if (f.sourceLayer) {
          t.sourceLayer = f.sourceLayer;
        }
        map.setFeatureState(t, { highlighted: true });
        next.push(t);
      }
    }
    selectionHighlightRef.current = next;
  };

  // The layers eligible for selection: both `selectable` AND currently visible,
  // tile layers first then markers (matches draw order / the layer control). Read
  // from refs so the once-bound EFFECT 5/6 handlers can call it safely.
  const selectionTargets = (map: maplibregl.Map): SelectionTarget[] => {
    const { layers, markerLayers } = renderRef.current;
    const isVisible = (id: string, dflt: boolean) => visibilityRef.current[id] ?? dflt;
    const targets: SelectionTarget[] = [];
    for (const l of layers) {
      if (l.selectable === false || !isVisible(l.id, l.visible !== false) || !map.getLayer(layerIdFor(l.id))) {
        continue;
      }
      targets.push({ mapLayerId: layerIdFor(l.id), layerId: l.id, layerName: l.name, isMarker: false, filter: filterOf(l), links: l.tooltipLinks ?? [] });
    }
    for (const l of markerLayers) {
      if (l.selectable === false || !isVisible(l.id, l.visible !== false) || !map.getLayer(mkLayerIdFor(l.id))) {
        continue;
      }
      targets.push({ mapLayerId: mkLayerIdFor(l.id), layerId: l.id, layerName: l.name, isMarker: true, filter: filterOf(l), links: l.tooltipLinks ?? [] });
    }
    return targets;
  };

  // Run a selection for a drawn geometry (box/lasso/line) and show the results.
  const runSelection = (geometry: SelectionGeometry) => {
    const map = mapRef.current;
    if (!map) {
      return;
    }
    // A fresh drawn selection replaces any accumulated click-select set.
    clickSelectedRef.current.clear();
    const result = runSelectionQuery({ map, geometry, targets: selectionTargets(map), maxPerLayer: 2000 });
    setSelection(result);
    highlightSelected(result);
  };

  // Click-select ("Pick"): toggle the top feature at a pixel point in/out of the
  // running selection, then rebuild the results from the accumulated set.
  const toggleClickSelect = (point: maplibregl.PointLike) => {
    const map = mapRef.current;
    if (!map) {
      return;
    }
    const targets = selectionTargets(map);
    const byId = new Map(targets.map((t) => [t.mapLayerId, t]));
    const f = map.queryRenderedFeatures(point, { layers: targets.map((t) => t.mapLayerId) })[0];
    if (!f) {
      return;
    }
    const target = byId.get(String(f.layer?.id ?? ''));
    if (!target) {
      return;
    }
    const key = dedupeKeyFor(f as any, target.filter);
    const acc = clickSelectedRef.current;
    if (acc.has(key)) {
      acc.delete(key); // clicking a selected feature removes it
    } else {
      acc.set(key, { target, feature: f });
    }
    // Rebuild from the accumulated features (targets still in layer order).
    const raw = Array.from(acc.values()).map((v) => v.feature);
    const result = buildSelectionResult(raw, targets, 2000);
    setSelection(result);
    highlightSelected(result);
  };

  // --- Measurement (ruler) ------------------------------------------------
  // Create the measure line + vertex layers once (geo-anchored, above overlays).
  const ensureMeasureLayers = (map: maplibregl.Map) => {
    if (!map.getSource(MEASURE_LINE_SRC)) {
      map.addSource(MEASURE_LINE_SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } as any });
      map.addLayer({
        id: MEASURE_LINE_LAYER,
        type: 'line',
        source: MEASURE_LINE_SRC,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': HIGHLIGHT_COLOR, 'line-width': 2.5, 'line-dasharray': [2, 1.5] },
      });
    }
    if (!map.getSource(MEASURE_PT_SRC)) {
      map.addSource(MEASURE_PT_SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } as any });
      map.addLayer({
        id: MEASURE_PT_LAYER,
        type: 'circle',
        source: MEASURE_PT_SRC,
        paint: { 'circle-radius': 4, 'circle-color': '#ffffff', 'circle-stroke-width': 2, 'circle-stroke-color': HIGHLIGHT_COLOR },
      });
    }
  };

  // Redraw the measure line/vertices GeoJSON from the committed points plus an
  // optional provisional point (the live cursor), and update the total readout.
  const redrawMeasure = (provisional?: [number, number]) => {
    const map = mapRef.current;
    if (!map) {
      return;
    }
    ensureMeasureLayers(map);
    const pts = [...measurePointsRef.current, ...(provisional ? [provisional] : [])];
    const lineSrc = map.getSource(MEASURE_LINE_SRC) as maplibregl.GeoJSONSource | undefined;
    const ptSrc = map.getSource(MEASURE_PT_SRC) as maplibregl.GeoJSONSource | undefined;
    if (lineSrc) {
      lineSrc.setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: pts.length >= 2 ? pts : [] }, properties: {} } as any);
    }
    if (ptSrc) {
      ptSrc.setData({
        type: 'FeatureCollection',
        features: measurePointsRef.current.map((c) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: {} })),
      } as any);
    }
    setMeasureMeters(pathLengthMeters(pts));
  };

  const clearMeasure = () => {
    measurePointsRef.current = [];
    redrawMeasure();
  };

  // --- Address search -------------------------------------------------------
  // Local search: match the query against marker layers' address fields, reading
  // the same data frames the markers are built from. Reads renderRef for the live
  // layer configs and the data prop for the rows.
  const localSearch = (query: string): SearchHit[] =>
    localFeatureSearch(renderRef.current.markerLayers, data?.series ?? [], query, 8);

  // External geocode on demand, using the configured provider. Variable
  // interpolation lets a custom URL carry an API key from a dashboard variable.
  const webSearch = (query: string, signal: AbortSignal): Promise<GeocodeResult[]> =>
    geocode(
      options.geocoder ?? 'nominatim',
      query,
      { url: options.geocoderUrl ?? '', interpolate: renderRef.current.replaceVariables },
      signal
    );

  // Place (or move) the search-result pin: a hollow ring marking the location.
  const setSearchPin = (lng: number, lat: number) => {
    const map = mapRef.current;
    if (!map) {
      return;
    }
    const data = { type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: {} } as any;
    const src = map.getSource(SEARCH_PIN_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (src) {
      src.setData(data);
    } else {
      map.addSource(SEARCH_PIN_SOURCE, { type: 'geojson', data });
      map.addLayer({
        id: SEARCH_PIN_LAYER,
        type: 'circle',
        source: SEARCH_PIN_SOURCE,
        paint: {
          'circle-radius': 10,
          'circle-color': HIGHLIGHT_COLOR,
          'circle-opacity': 0.25,
          'circle-stroke-width': 2,
          'circle-stroke-color': HIGHLIGHT_COLOR,
        },
      });
    }
  };

  // Remove the pin and close the search popup.
  const clearSearch = () => {
    const map = mapRef.current;
    if (map) {
      if (map.getLayer(SEARCH_PIN_LAYER)) {
        map.removeLayer(SEARCH_PIN_LAYER);
      }
      if (map.getSource(SEARCH_PIN_SOURCE)) {
        map.removeSource(SEARCH_PIN_SOURCE);
      }
    }
    popupRef.current?.remove();
    popupRef.current = null;
  };

  // User picked a search result: fly there, drop the pin, and open a popup. A
  // local hit shows the feature's attributes (via the layer's tooltip config); a
  // web hit shows the geocoded label.
  const handlePick = (hit: SearchHit) => {
    const map = mapRef.current;
    if (!map) {
      return;
    }
    if (hit.source === 'web' && hit.bbox) {
      map.fitBounds(
        [
          [hit.bbox[0], hit.bbox[1]],
          [hit.bbox[2], hit.bbox[3]],
        ],
        { maxZoom: 17, padding: 40, duration: 800 }
      );
    } else {
      map.flyTo({ center: [hit.lng, hit.lat], zoom: Math.max(map.getZoom(), 16), duration: 800 });
    }
    setSearchPin(hit.lng, hit.lat);

    // Build the popup HTML.
    let html: string;
    if (hit.source === 'local') {
      const layerCfg = renderRef.current.markerLayers.find((l) => l.id === hit.layerId);
      html = buildPropsTable(hit.props, {
        hideEmpty: layerCfg?.tooltipHideEmpty ?? true,
        include: layerCfg?.tooltipInclude ?? '',
        exclude: layerCfg?.tooltipExclude ?? '',
        titleField: layerCfg?.tooltipTitleField ?? hit.layerName,
        links: layerCfg?.tooltipLinks ?? [],
        replaceVariables: renderRef.current.replaceVariables,
        keyColor: renderRef.current.keyColor,
        titleColor: renderRef.current.titleColor,
        mutedColor: renderRef.current.mutedColor,
        linkColor: renderRef.current.linkColor,
      });
    } else {
      html = `<div style="font-size:12px;color:${renderRef.current.titleColor}">${escapeHtml(hit.label)}</div>`;
    }

    popupRef.current?.remove();
    popupRef.current = new maplibregl.Popup({ maxWidth: '360px', closeOnClick: false, className: renderRef.current.popupClass })
      .setLngLat([hit.lng, hit.lat])
      .setHTML(html)
      .addTo(map);
  };

  // EFFECT 1 — create the map exactly once, on mount, with an EMPTY style plus a
  // background layer. The actual basemap is added by EFFECT B so it can be
  // swapped without disturbing overlays.
  useEffect(() => {
    if (!containerRef.current) {
      return;
    }
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        // Glyph (font) endpoint — REQUIRED for any text label (the marker "label
        // views" feature). Defaults to MapLibre's font server; the panel's
        // glyphsUrl option can point at a self-hosted server (kept live via
        // map.setGlyphs in EFFECT G). If unreachable, labels just don't render;
        // the rest of the map is unaffected.
        glyphs: options.glyphsUrl || DEFAULT_GLYPHS,
        sources: {},
        layers: [{ id: 'bg', type: 'background', paint: { 'background-color': theme.colors.background.secondary } }],
      },
      center: [options.initialLng, options.initialLat], // MapLibre order is [lng, lat]
      zoom: options.initialZoom,
    });
    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // EFFECT G — keep the glyph (font) server in sync with the option. setGlyphs
  // re-fetches fonts and re-renders label layers, so changing the URL applies
  // live (no map recreation). Waits for the style if it isn't loaded yet.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }
    const url = options.glyphsUrl || DEFAULT_GLYPHS;
    const apply = () => map.setGlyphs(url);
    if (map.isStyleLoaded()) {
      apply();
    } else {
      map.once('load', apply);
    }
    return () => {
      map.off('load', apply);
    };
  }, [options.glyphsUrl]);

  // Resolve the EFFECTIVE basemap: when the admin curated a switcher list, the
  // viewer-selected choice wins (first entry is the default); otherwise the single
  // `basemap` option is used. The interpolated URL only matters for 'custom'.
  const basemapChoices = options.basemapChoices ?? [];
  const activeChoice = basemapChoices.length > 0 ? basemapChoices[activeBasemapIdx] ?? basemapChoices[0] : undefined;
  const effectiveBasemapKind = activeChoice ? activeChoice.kind : options.basemap;
  const basemapUrlInterp = replaceVariables(activeChoice ? activeChoice.url : options.basemapUrl ?? '');

  // EFFECT B — add/swap the basemap raster layer beneath the overlays.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }
    const applyBasemap = () => {
      if (map.getLayer(BASEMAP_LAYER_ID)) {
        map.removeLayer(BASEMAP_LAYER_ID);
      }
      if (map.getSource(BASEMAP_SOURCE_ID)) {
        map.removeSource(BASEMAP_SOURCE_ID);
      }
      // Interpolate dashboard/template variables in the custom URL (e.g. an API
      // key or region kept in a Grafana variable).
      const spec = basemapSourceSpec(effectiveBasemapKind, basemapUrlInterp);
      if (!spec) {
        return; // 'none' (or custom with empty URL) — leave just the background
      }
      map.addSource(BASEMAP_SOURCE_ID, spec);
      // Insert below the first overlay (vector tile layer or marker layer) so all
      // overlays stay on top of the basemap.
      const firstOverlay = (map.getStyle().layers ?? []).find(
        (l) => l.id.startsWith(VT_LAYER_PREFIX) || l.id.startsWith(MK_LAYER_PREFIX)
      )?.id;
      map.addLayer({ id: BASEMAP_LAYER_ID, type: 'raster', source: BASEMAP_SOURCE_ID }, firstOverlay);
    };
    if (map.isStyleLoaded()) {
      applyBasemap();
    } else {
      map.once('load', applyBasemap);
    }
    return () => {
      map.off('load', applyBasemap);
    };
    // Depend on the resolved kind (switcher choice or single option) and the
    // INTERPOLATED url so swapping a dashboard variable OR the viewer picking a
    // different basemap re-runs this effect.
  }, [effectiveBasemapKind, basemapUrlInterp]);

  // EFFECT 2 — keep the canvas sized to the panel.
  useEffect(() => {
    mapRef.current?.resize();
  }, [width, height]);

  // EFFECT 3 — move the map when the initial-view options change.
  useEffect(() => {
    mapRef.current?.jumpTo({
      center: [options.initialLng, options.initialLat],
      zoom: options.initialZoom,
    });
  }, [options.initialLat, options.initialLng, options.initialZoom]);

  // Key built from the INTERPOLATED tile URLs + filters. EFFECT 4 depends on it so
  // that changing a dashboard variable (which doesn't change `options` identity)
  // still rebuilds the tile layers with the new interpolated values.
  const layersInterpKey = (options.layers ?? [])
    .map((l) => `${l.id}${replaceVariables(l.tileUrl ?? '')}${replaceVariables(l.filterExpression ?? '')}`)
    .join('|');

  // EFFECT 4 — (re)build every configured vector tile layer (remove ours, add the
  // current set). Each layer gets its initial visibility from the live runtime
  // visibility state (via the ref) so toggles survive a rebuild.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    const applyLayers = () => {
      const style = map.getStyle();
      (style.layers ?? []).forEach((l) => {
        if (l.id.startsWith(VT_LAYER_PREFIX)) {
          map.removeLayer(l.id);
        }
      });
      Object.keys(style.sources ?? {}).forEach((s) => {
        if (s.startsWith(VT_SOURCE_PREFIX)) {
          map.removeSource(s);
        }
      });
      popupRef.current?.remove();
      popupRef.current = null;
      highlightRef.current = null;

      for (const layer of options.layers ?? []) {
        if (!layer.tileUrl || !layer.sourceLayer) {
          continue;
        }
        const sId = sourceIdFor(layer.id);
        const lId = layerIdFor(layer.id);
        const lineColor = theme.visualization.getColorByName(layer.lineColor ?? '#ff5722');
        const fillColor = theme.visualization.getColorByName(layer.fillColor ?? '#3388ff');
        const circleColor = theme.visualization.getColorByName(layer.circleColor ?? '#1f77b4');
        const lineWidth = layer.lineWidth ?? 2;
        const fillOpacity = layer.fillOpacity ?? 0.4;
        const circleRadius = layer.circleRadius ?? 5;
        const desiredVisible = visibilityRef.current[layer.id] ?? layer.visible !== false;
        const vis: 'visible' | 'none' = desiredVisible ? 'visible' : 'none';

        // Interpolate dashboard/template variables in the tile URL (e.g.
        // ${region} or a filter token) before handing it to MapLibre.
        const tileUrl = replaceVariables(layer.tileUrl);

        try {
          // promoteId lifts a feature PROPERTY to the feature id so feature-state
          // highlighting + exact Select-area de-dup work on tiles that ship no
          // built-in id (GeoServer). Keyed by source-layer, per MapLibre's spec.
          const idField = layer.idField?.trim();
          const promoteId = idField ? { [layer.sourceLayer]: idField } : undefined;
          map.addSource(sId, { type: 'vector', tiles: [tileUrl], scheme: layer.tileScheme, promoteId });

          if (layer.geometryType === 'fill') {
            map.addLayer({
              id: lId,
              type: 'fill',
              source: sId,
              'source-layer': layer.sourceLayer,
              layout: { visibility: vis },
              paint: {
                'fill-color': whenHighlighted(HIGHLIGHT_COLOR, fillColor),
                'fill-opacity': whenHighlighted(Math.min(fillOpacity + 0.3, 1), fillOpacity),
              },
            });
          } else if (layer.geometryType === 'circle') {
            // A registry icon (SDF symbol, recolorable) if one is set, else a
            // plain native circle. Mirrors the marker-layer circle-vs-symbol split.
            const useIcon = layer.icon && layer.icon !== 'circle';
            if (useIcon) {
              ensureShapeIcon(map, layer.icon);
              map.addLayer({
                id: lId,
                type: 'symbol',
                source: sId,
                'source-layer': layer.sourceLayer,
                layout: {
                  visibility: vis,
                  'icon-image': iconIdForShape(layer.icon),
                  // circleRadius is the icon "radius"; scale the SDF so its diameter
                  // matches a circle of that radius.
                  'icon-size': (2 * circleRadius) / SHAPE_ICON_EFFECTIVE,
                  'icon-allow-overlap': true,
                  'icon-ignore-placement': true,
                },
                paint: {
                  'icon-color': whenHighlighted(HIGHLIGHT_COLOR, circleColor),
                  'icon-halo-color': '#ffffff',
                  'icon-halo-width': whenHighlighted(2.5, 1),
                },
              });
            } else {
              map.addLayer({
                id: lId,
                type: 'circle',
                source: sId,
                'source-layer': layer.sourceLayer,
                layout: { visibility: vis },
                paint: {
                  'circle-color': whenHighlighted(HIGHLIGHT_COLOR, circleColor),
                  'circle-radius': whenHighlighted(circleRadius + 3, circleRadius),
                  'circle-stroke-width': 1,
                  'circle-stroke-color': '#ffffff',
                },
              });
            }
          } else {
            // Line geometry: optional dash pattern (solid omits line-dasharray).
            const dash = LINE_DASH[layer.lineStyle ?? 'solid'];
            const linePaint: Record<string, unknown> = {
              'line-color': whenHighlighted(HIGHLIGHT_COLOR, lineColor),
              'line-width': whenHighlighted(lineWidth + 3, lineWidth),
            };
            if (dash) {
              linePaint['line-dasharray'] = dash;
            }
            map.addLayer({
              id: lId,
              type: 'line',
              source: sId,
              'source-layer': layer.sourceLayer,
              layout: { visibility: vis, 'line-cap': 'round', 'line-join': 'round' },
              paint: linePaint,
            });
          }

          if (layer.filterExpression?.trim()) {
            try {
              // Interpolate variables inside the filter JSON too (e.g. a value
              // pulled from a dashboard variable).
              map.setFilter(lId, JSON.parse(replaceVariables(layer.filterExpression)));
            } catch (err) {
              console.warn(`[vectormap] invalid filter for layer "${layer.name}":`, err);
            }
          }
        } catch (err) {
          console.error(`[vectormap] failed to add layer "${layer.name}":`, err);
        }
      }
      // Keep all marker layers (dots + their text labels) above the (re-added)
      // vector tile overlays. Iterating in style order preserves each label's
      // position above its own dot.
      (map.getStyle().layers ?? []).forEach((l) => {
        if (l.id.startsWith(MK_LAYER_PREFIX) || l.id.startsWith(MK_LABEL_PREFIX)) {
          map.moveLayer(l.id);
        }
      });
    };

    if (map.isStyleLoaded()) {
      applyLayers();
    } else {
      map.once('load', applyLayers);
    }
    return () => {
      map.off('load', applyLayers);
    };
    // layersInterpKey re-runs this when an interpolated URL/filter changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.layers, theme, layersInterpKey]);

  // EFFECT M — reconcile the marker layers (one GeoJSON source + circle layer per
  // configured marker layer) against the panel's query results. For each layer we
  // setData on its existing source (cheap refresh) or add it; sources/layers for
  // marker layers that were deleted are removed. Kept on top of the tile overlays.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }
    const applyMarkers = () => {
      const cfgs = options.markerLayers ?? [];
      const desiredLayerIds = new Set(cfgs.map((l) => mkLayerIdFor(l.id)));
      const desiredSourceIds = new Set(cfgs.map((l) => mkSourceIdFor(l.id)));

      const desiredLabelIds = new Set(cfgs.map((l) => mkLabelIdFor(l.id)));

      // Drop marker draw layers, label layers, and sources whose config was removed.
      const style = map.getStyle();
      (style.layers ?? []).forEach((l) => {
        if (l.id.startsWith(MK_LAYER_PREFIX) && !desiredLayerIds.has(l.id)) {
          map.removeLayer(l.id);
        }
        if (l.id.startsWith(MK_LABEL_PREFIX) && !desiredLabelIds.has(l.id)) {
          map.removeLayer(l.id);
        }
      });
      Object.keys(style.sources ?? {}).forEach((s) => {
        if (s.startsWith(MK_SOURCE_PREFIX) && !desiredSourceIds.has(s)) {
          map.removeSource(s);
        }
      });

      for (const cfg of cfgs) {
        const sId = mkSourceIdFor(cfg.id);
        const lId = mkLayerIdFor(cfg.id);
        const fc = buildMarkerFeatures(data?.series ?? [], cfg, theme.visualization.getColorByName);

        // Source: update in place if present, else create. generateId assigns
        // numeric feature ids so feature-state highlight works.
        const existingSrc = map.getSource(sId) as maplibregl.GeoJSONSource | undefined;
        if (existingSrc) {
          existingSrc.setData(fc);
        } else {
          map.addSource(sId, { type: 'geojson', data: fc, generateId: true });
        }

        // Shape decides the draw layer type: 'circle' uses a native circle layer;
        // any other shape uses an SDF symbol layer (recolorable icon). If the shape
        // changed between those two families, the existing layer is the wrong type
        // and must be dropped and re-added (the source/data are kept).
        const shape = cfg.shape ?? 'circle';
        const desiredType: 'circle' | 'symbol' = shape === 'circle' ? 'circle' : 'symbol';
        const existingLayer = map.getLayer(lId);
        if (existingLayer && existingLayer.type !== desiredType) {
          map.removeLayer(lId);
        }

        if (!map.getLayer(lId)) {
          if (desiredType === 'circle') {
            map.addLayer({
              id: lId,
              type: 'circle',
              source: sId,
              paint: {
                // Per-feature color/radius come from the GeoJSON properties.
                'circle-color': whenHighlighted(HIGHLIGHT_COLOR, ['get', '__color']),
                'circle-radius': whenHighlighted(['+', ['get', '__radius'], 3], ['get', '__radius']),
                'circle-stroke-width': 1,
                'circle-stroke-color': '#ffffff',
              },
            });
          } else {
            ensureShapeIcon(map, shape);
            map.addLayer({
              id: lId,
              type: 'symbol',
              source: sId,
              layout: {
                'icon-image': iconIdForShape(shape),
                // Scale the SDF (drawn at SHAPE_ICON_EFFECTIVE px) so the marker's
                // diameter (2·__radius) matches what a circle of that radius shows.
                'icon-size': ['/', ['*', 2, ['get', '__radius']], SHAPE_ICON_EFFECTIVE],
                // Dense markers: don't let collision detection drop any.
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
              },
              paint: {
                // SDF icons are recolorable: per-feature color, cyan on highlight,
                // with a white halo standing in for the circle's stroke.
                'icon-color': whenHighlighted(HIGHLIGHT_COLOR, ['get', '__color']),
                'icon-halo-color': '#ffffff',
                'icon-halo-width': whenHighlighted(2.5, 1),
              },
            });
          }
        } else if (desiredType === 'symbol') {
          // Same symbol layer, but the shape may have changed to another icon.
          ensureShapeIcon(map, shape);
          map.setLayoutProperty(lId, 'icon-image', iconIdForShape(shape));
        }

        // Initial visibility from the live runtime override (ref), else the config.
        const desiredVisible = visibilityRef.current[cfg.id] ?? cfg.visible !== false;
        map.setLayoutProperty(lId, 'visibility', desiredVisible ? 'visible' : 'none');

        // --- Text label layer (viewer-selectable "label view") ----------------
        // A SEPARATE symbol layer over the dot, so the colored anchor is always
        // kept. Its text-field + visibility are driven by the active view (ref);
        // when no view is active the layer is simply hidden.
        const labelId = mkLabelIdFor(cfg.id);
        if (!map.getLayer(labelId)) {
          map.addLayer({
            id: labelId,
            type: 'symbol',
            source: sId,
            layout: {
              'text-field': '',
              'text-anchor': 'left',
              'text-offset': [0.8, 0], // sit just right of the dot
              'text-allow-overlap': false, // declutter: drop colliding labels
              'text-optional': true,
            },
          });
        }
        // Label text formatting (applied every run so option edits take effect).
        const labelColor = cfg.labelTextColor
          ? theme.visualization.getColorByName(cfg.labelTextColor)
          : theme.colors.text.primary;
        const haloColor = cfg.labelHaloColor
          ? theme.visualization.getColorByName(cfg.labelHaloColor)
          : theme.colors.background.primary;
        map.setLayoutProperty(labelId, 'text-font', labelFont(cfg.labelFontFamily, cfg.labelFontStyle ?? 'regular'));
        map.setLayoutProperty(labelId, 'text-size', cfg.labelTextSize || 12);
        map.setPaintProperty(labelId, 'text-color', labelColor);
        map.setPaintProperty(labelId, 'text-halo-color', haloColor);
        map.setPaintProperty(labelId, 'text-halo-width', cfg.labelHaloWidth ?? 1.5);
        // Apply the active label view: show the chosen field's text when a view is
        // picked AND the layer is visible; otherwise hide the label layer.
        const activeViewName = labelViewRef.current[cfg.id] ?? '';
        const activeField = (cfg.labelViews ?? []).find((v) => v.name === activeViewName)?.field ?? '';
        if (activeField) {
          map.setLayoutProperty(labelId, 'text-field', ['to-string', ['get', activeField]]);
        }
        map.setLayoutProperty(labelId, 'visibility', desiredVisible && activeField ? 'visible' : 'none');
      }
    };
    if (map.isStyleLoaded()) {
      applyMarkers();
    } else {
      map.once('load', applyMarkers);
    }
    return () => {
      map.off('load', applyMarkers);
    };
  }, [data, options.markerLayers, theme]);

  // EFFECT 5 — feature interactivity across ALL vector tile layers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }
    const ourLayerIds = (): string[] =>
      (map.getStyle().layers ?? [])
        .map((l) => l.id)
        .filter((id) => id.startsWith(VT_LAYER_PREFIX) || id.startsWith(MK_LAYER_PREFIX));

    const clearHighlight = () => {
      if (highlightRef.current) {
        map.setFeatureState(highlightRef.current, { highlighted: false });
        highlightRef.current = null;
      }
    };

    const onClick = (e: maplibregl.MapMouseEvent) => {
      // Measure mode: a click adds a vertex to the measured path.
      if (measureModeRef.current) {
        measurePointsRef.current = [...measurePointsRef.current, [e.lngLat.lng, e.lngLat.lat]];
        redrawMeasure();
        return;
      }
      // While a Select tool is active, a click either picks a feature (the 'click'
      // tool) or is part of drawing a shape (handled by EFFECT 6) — no popup.
      if (selectModeRef.current) {
        if (selectToolRef.current === 'click') {
          toggleClickSelect(e.point);
        }
        return;
      }
      const ids = ourLayerIds();
      clearHighlight();
      popupRef.current?.remove();
      popupRef.current = null;
      if (!ids.length) {
        return;
      }
      const f = map.queryRenderedFeatures(e.point, { layers: ids })[0];
      if (!f) {
        return;
      }
      // Highlight needs a stable feature id (feature-state is keyed on it). Marker
      // (GeoJSON) sources get one from generateId, but GeoServer/MVT tiles often
      // ship features with NO id — MapLibre then returns f.id === undefined. In
      // that case highlightTargetFor returns null and we still show the tooltip
      // below (the properties are present — that's why the same tiles render
      // attributes in OpenLayers); we just can't highlight.
      const target = highlightTargetFor(f);
      if (target) {
        map.setFeatureState(target, { highlighted: true });
        highlightRef.current = target;
      }

      // Resolve the clicked feature's LAYER to pick up its per-layer tooltip
      // rules — searching both the tile layers and the marker layers, since the
      // click can land on either. Both config shapes carry the same tooltip
      // fields, so the same lookup works for both.
      const clickedId = String(f.layer?.id ?? '');
      const layerCfg: Pick<
        VectorTileLayerConfig,
        'tooltipHideEmpty' | 'tooltipInclude' | 'tooltipExclude' | 'tooltipTitleField' | 'tooltipLinks'
      > | undefined = clickedId.startsWith(MK_LAYER_PREFIX)
        ? renderRef.current.markerLayers.find((l) => l.id === clickedId.slice(MK_LAYER_PREFIX.length))
        : renderRef.current.layers.find((l) => l.id === clickedId.slice(VT_LAYER_PREFIX.length));
      const cfg: TooltipRenderConfig = {
        hideEmpty: layerCfg?.tooltipHideEmpty ?? true,
        include: layerCfg?.tooltipInclude ?? '',
        exclude: layerCfg?.tooltipExclude ?? '',
        titleField: layerCfg?.tooltipTitleField ?? '',
        links: layerCfg?.tooltipLinks ?? [],
        replaceVariables: renderRef.current.replaceVariables,
        keyColor: renderRef.current.keyColor,
        titleColor: renderRef.current.titleColor,
        mutedColor: renderRef.current.mutedColor,
        linkColor: renderRef.current.linkColor,
      };
      const popup = new maplibregl.Popup({ maxWidth: '360px', closeOnClick: false, className: renderRef.current.popupClass })
        .setLngLat(e.lngLat)
        .setHTML(buildPropsTable(f.properties ?? {}, cfg))
        .addTo(map);
      popup.on('close', clearHighlight);
      popupRef.current = popup;
    };

    const onMove = (e: maplibregl.MapMouseEvent) => {
      // Measure mode: crosshair + a provisional segment from the last vertex to the
      // cursor (so the running total previews the next click).
      if (measureModeRef.current) {
        map.getCanvas().style.cursor = 'crosshair';
        if (measurePointsRef.current.length > 0) {
          redrawMeasure([e.lngLat.lng, e.lngLat.lat]);
        }
        return;
      }
      // In select mode show a crosshair and skip the hover hit-test (the box
      // overlay owns the interaction).
      if (selectModeRef.current) {
        map.getCanvas().style.cursor = 'crosshair';
        return;
      }
      const ids = ourLayerIds();
      const hit = ids.length > 0 && map.queryRenderedFeatures(e.point, { layers: ids }).length > 0;
      map.getCanvas().style.cursor = hit ? 'pointer' : '';
    };

    map.on('click', onClick);
    map.on('mousemove', onMove);
    return () => {
      map.off('click', onClick);
      map.off('mousemove', onMove);
      popupRef.current?.remove();
      popupRef.current = null;
    };
    // Bound once; the handlers read live state via refs (selectModeRef, measureModeRef,
    // selectToolRef, renderRef) and call ref-backed helpers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // EFFECT 6 — the "Select area" drawing tool (box OR lasso). Bound once (like
  // EFFECT 5); it reads live state via selectModeRef/selectToolRef + renderRef.
  // We attach native DOM listeners (rather than MapLibre's) so we get pixel
  // coordinates and full control, and draw the live shape into an SVG overlay.
  useEffect(() => {
    const map = mapRef.current;
    const container = containerRef.current;
    if (!map || !container) {
      return;
    }

    // One SVG overlay drives the drag tools: a filled <polygon> for box/lasso, and
    // an open stroked <polyline> for the line/trace tools. Drawn imperatively (not
    // via React) because a drag fires far faster than React state updates.
    const SVGNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:3;display:none';
    const shape = document.createElementNS(SVGNS, 'polygon');
    shape.setAttribute('fill', 'rgba(0,229,255,0.12)');
    shape.setAttribute('stroke', HIGHLIGHT_COLOR);
    shape.setAttribute('stroke-width', '1.5');
    shape.setAttribute('stroke-dasharray', '5 3');
    const polyline = document.createElementNS(SVGNS, 'polyline');
    polyline.setAttribute('fill', 'none');
    polyline.setAttribute('stroke', HIGHLIGHT_COLOR);
    polyline.setAttribute('stroke-width', '2.5');
    polyline.setAttribute('stroke-dasharray', '5 3');
    svg.appendChild(shape);
    svg.appendChild(polyline);
    container.appendChild(svg);

    let dragging = false;
    let mode: SelectTool = 'box';
    let start: [number, number] | null = null; // box/line: the first point (canvas px)
    let pts: Array<[number, number]> = []; // lasso/trace: the freehand points (canvas px)
    const TINY = 4; // px — a drag smaller than this is treated as a stray click
    const MIN_STEP = 3; // px — minimum spacing between recorded freehand points

    // Re-enable the map's own drag handlers (called on release/cleanup).
    const enableMapDrag = () => {
      map.dragPan.enable();
      map.boxZoom.enable();
      map.dragRotate.enable();
    };

    // Pointer position in map-canvas pixels (origin = canvas top-left). The SVG
    // overlay shares this origin (it fills the same container), so these same
    // coordinates drive both the drawn shape and the feature query.
    const localPoint = (ev: MouseEvent): [number, number] => {
      const r = map.getCanvas().getBoundingClientRect();
      return [ev.clientX - r.left, ev.clientY - r.top];
    };
    const toPoints = (arr: Array<[number, number]>) => arr.map((p) => `${p[0]},${p[1]}`).join(' ');
    const setPolygon = (arr: Array<[number, number]>) => {
      shape.setAttribute('points', toPoints(arr));
      polyline.setAttribute('points', ''); // hide the line element
    };
    const setPolyline = (arr: Array<[number, number]>) => {
      polyline.setAttribute('points', toPoints(arr));
      shape.setAttribute('points', ''); // hide the polygon element
    };

    const onDown = (ev: MouseEvent) => {
      if (!selectModeRef.current || ev.button !== 0 || selectToolRef.current === 'click') {
        return; // only left-button drags for the DRAWING tools ('click' isn't one)
      }
      dragging = true;
      mode = selectToolRef.current;
      map.dragPan.disable();
      map.boxZoom.disable();
      map.dragRotate.disable();
      const p = localPoint(ev);
      if (mode === 'box') {
        start = p;
        setPolygon([p, p, p, p]);
      } else if (mode === 'lasso') {
        pts = [p];
        setPolygon(pts);
      } else {
        // line (straight) / trace (freehand) — an open polyline.
        start = p;
        pts = [p];
        setPolyline(pts);
      }
      svg.style.display = 'block';
      ev.preventDefault();
    };

    const onMoveDoc = (ev: MouseEvent) => {
      if (!dragging) {
        return;
      }
      const p = localPoint(ev);
      if (mode === 'box' && start) {
        // A rectangle expressed as its four corners.
        setPolygon([[start[0], start[1]], [p[0], start[1]], [p[0], p[1]], [start[0], p[1]]]);
      } else if (mode === 'lasso') {
        const last = pts[pts.length - 1];
        if (!last || Math.abs(p[0] - last[0]) + Math.abs(p[1] - last[1]) >= MIN_STEP) {
          pts.push(p);
          setPolygon(pts);
        }
      } else if (mode === 'line' && start) {
        setPolyline([start, p]); // straight: just start → cursor
      } else if (mode === 'trace') {
        const last = pts[pts.length - 1];
        if (!last || Math.abs(p[0] - last[0]) + Math.abs(p[1] - last[1]) >= MIN_STEP) {
          pts.push(p);
          setPolyline(pts);
        }
      }
    };

    const onUp = (ev: MouseEvent) => {
      if (!dragging) {
        return;
      }
      dragging = false;
      enableMapDrag();
      svg.style.display = 'none';
      const p = localPoint(ev);
      if (mode === 'box' && start) {
        const s = start;
        start = null;
        if (Math.abs(p[0] - s[0]) < TINY && Math.abs(p[1] - s[1]) < TINY) {
          return; // tiny drag — treat as a stray click, select nothing
        }
        runSelection({ kind: 'box', p1: s, p2: p });
      } else if (mode === 'lasso') {
        const poly = pts;
        pts = [];
        if (poly.length >= 3) {
          runSelection({ kind: 'polygon', points: poly });
        }
      } else if (mode === 'line' && start) {
        const s = start;
        start = null;
        if (Math.abs(p[0] - s[0]) < TINY && Math.abs(p[1] - s[1]) < TINY) {
          return; // a click, not a line
        }
        runSelection({ kind: 'line', points: [s, p] });
      } else if (mode === 'trace') {
        const poly = pts;
        pts = [];
        if (poly.length >= 2) {
          runSelection({ kind: 'line', points: poly });
        }
      }
    };

    container.addEventListener('mousedown', onDown);
    // Listen on window for move/up so a drag that leaves the panel still finishes.
    window.addEventListener('mousemove', onMoveDoc);
    window.addEventListener('mouseup', onUp);

    return () => {
      container.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMoveDoc);
      window.removeEventListener('mouseup', onUp);
      svg.remove();
      if (dragging) {
        enableMapDrag(); // safety: unmounted mid-drag
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reflect a marker layer's active label view onto its text-label layer: set the
  // chosen field as text-field and show it only when a view is active AND the
  // layer itself is visible. Shared by toggle + label-view handlers.
  const applyMarkerLabel = (map: maplibregl.Map, layerId: string, layerVisible: boolean) => {
    const labelId = mkLabelIdFor(layerId);
    if (!map.getLayer(labelId)) {
      return;
    }
    const cfg = (options.markerLayers ?? []).find((l) => l.id === layerId);
    const activeViewName = labelViewRef.current[layerId] ?? '';
    const activeField = (cfg?.labelViews ?? []).find((v) => v.name === activeViewName)?.field ?? '';
    if (activeField) {
      map.setLayoutProperty(labelId, 'text-field', ['to-string', ['get', activeField]]);
    }
    map.setLayoutProperty(labelId, 'visibility', layerVisible && activeField ? 'visible' : 'none');
  };

  // Flip one layer's MapLibre visibility (tile OR marker, whichever exists) and
  // keep its text-label layer in sync. Does NOT touch React state — callers own
  // that so a group toggle can batch a single setVisibility.
  const applyLayerVisibility = (map: maplibregl.Map, layerId: string, visible: boolean) => {
    const vis: 'visible' | 'none' = visible ? 'visible' : 'none';
    const vtId = layerIdFor(layerId);
    const mkId = mkLayerIdFor(layerId);
    if (map.getLayer(vtId)) {
      map.setLayoutProperty(vtId, 'visibility', vis);
    }
    if (map.getLayer(mkId)) {
      map.setLayoutProperty(mkId, 'visibility', vis);
    }
    applyMarkerLabel(map, layerId, visible);
  };

  // Toggle a single layer from the LayerControl: update state + apply immediately.
  const handleToggle = (layerId: string, visible: boolean) => {
    setVisibility((prev) => ({ ...prev, [layerId]: visible }));
    const map = mapRef.current;
    if (map) {
      applyLayerVisibility(map, layerId, visible);
    }
  };

  // Toggle every layer in a group at once (the group heading checkbox). Group
  // membership is read straight from the options (both tile and marker layers),
  // matching how the LayerControl buckets by the `group` field.
  const handleToggleGroup = (groupName: string, visible: boolean) => {
    const ids = [...(options.layers ?? []), ...(options.markerLayers ?? [])]
      .filter((l) => (l.group || '') === groupName)
      .map((l) => l.id);
    setVisibility((prev) => {
      const next = { ...prev };
      for (const id of ids) {
        next[id] = visible;
      }
      return next;
    });
    const map = mapRef.current;
    if (map) {
      for (const id of ids) {
        applyLayerVisibility(map, id, visible);
      }
    }
  };

  // Pick a marker layer's active label view from the LayerControl dropdown:
  // update state + re-apply the label layer immediately (respecting visibility).
  const handleSelectLabelView = (layerId: string, viewName: string) => {
    setLabelView((prev) => ({ ...prev, [layerId]: viewName }));
    const map = mapRef.current;
    if (!map) {
      return;
    }
    // labelViewRef is updated by an effect after state commits; use the new value
    // now so the label reflects the pick without waiting a render.
    labelViewRef.current = { ...labelViewRef.current, [layerId]: viewName };
    const layerVisible = visibilityRef.current[layerId] ?? true;
    applyMarkerLabel(map, layerId, layerVisible);
  };

  // "Set initial view": capture the map's current center/zoom into the options.
  const handleSetInitialView = () => {
    const map = mapRef.current;
    if (!map) {
      return;
    }
    const center = map.getCenter();
    const zoom = map.getZoom();
    onOptionsChange({
      ...options,
      initialLat: Number(center.lat.toFixed(6)),
      initialLng: Number(center.lng.toFixed(6)),
      initialZoom: Number(zoom.toFixed(2)),
    });
  };

  // Toggle the Select-area tool. Turning it on exits measure mode (mutually
  // exclusive) and closes any single-feature popup.
  const toggleSelectMode = () => {
    setSelectMode((on) => {
      const next = !on;
      if (next) {
        setMeasureMode(false);
        popupRef.current?.remove();
        popupRef.current = null;
      }
      return next;
    });
  };

  // Toggle the Measure tool. Turning it on exits select mode; turning it off clears
  // the drawn measurement.
  const toggleMeasureMode = () => {
    setMeasureMode((on) => {
      const next = !on;
      const map = mapRef.current;
      if (next) {
        setSelectMode(false);
        map?.doubleClickZoom.disable(); // clicks add vertices; don't zoom on dblclick
      } else {
        clearMeasure();
        map?.doubleClickZoom.enable();
      }
      return next;
    });
  };

  // Escape clears the current measurement while measuring.
  useEffect(() => {
    if (!measureMode) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        clearMeasure();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measureMode]);

  // Build the unified layer-control list: drawable tile layers plus all marker
  // layers, each normalized to { id, name, group, color }. The swatch color is
  // the geometry's paint color for tile layers, or the fixed color for markers.
  const controlLayers: ControlLayer[] = [
    ...(options.layers ?? [])
      .filter((l) => l.tileUrl && l.sourceLayer) // only actually-drawable tile layers
      .map((l) => ({
        id: l.id,
        name: l.name,
        group: l.group,
        // Legend icon matches the geometry: line=bar, fill=square, circle=dot (or
        // the layer's chosen icon for a circle layer).
        shape: (l.geometryType === 'fill'
          ? 'square'
          : l.geometryType === 'circle'
            ? l.icon && l.icon !== 'circle'
              ? l.icon
              : 'circle'
            : 'line') as LegendShape,
        color:
          l.geometryType === 'fill'
            ? l.fillColor || '#3388ff'
            : l.geometryType === 'circle'
              ? l.circleColor || '#1f77b4'
              : l.lineColor || '#ff5722',
      })),
    ...(options.markerLayers ?? []).map((l) => ({
      id: l.id,
      name: l.name,
      group: l.group,
      shape: (l.shape ?? 'circle') as LegendShape, // legend matches the marker shape
      color: l.fixedColor || '#1f77b4',
      labelViews: l.labelViews ?? [], // enables the per-layer label-view dropdown
    })),
  ];

  // Effective visibility shown in the LayerControl = explicit override, else the
  // layer's configured default. Derived during render (no state/effect needed),
  // across both tile layers and marker layers.
  const effectiveVisibility: Record<string, boolean> = {};
  for (const l of [...(options.layers ?? []), ...(options.markerLayers ?? [])]) {
    effectiveVisibility[l.id] = visibility[l.id] ?? l.visible !== false;
  }

  return (
    <div
      data-testid="vectormap-panel"
      className={mapShellClass}
      style={{ width, height, position: 'relative', overflow: 'hidden' }}
    >
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
      {/* Opaque chrome so the tools stay legible over any basemap (light or dark)
          — the raw secondary buttons blend into pale basemaps otherwise. */}
      <div
        style={{
          position: 'absolute',
          top: 8,
          left: 8,
          zIndex: 1,
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          background: theme.colors.background.primary,
          border: `1px solid ${theme.colors.border.weak}`,
          borderRadius: theme.shape.radius.default,
          padding: 4,
          boxShadow: theme.shadows.z2,
        }}
      >
        <Button
          size="sm"
          variant="secondary"
          onClick={handleSetInitialView}
          title="Save the map's current center and zoom as this panel's initial view"
        >
          Set initial view
        </Button>
        <Button
          size="sm"
          variant={selectMode ? 'primary' : 'secondary'}
          icon="gf-show-context"
          onClick={toggleSelectMode}
          title="Select features on the map (box, lasso, line, or click)"
        >
          {selectMode ? 'Selecting…' : 'Select area'}
        </Button>
        {selectMode && (
          // Pick the selection tool: rectangle, freehand outline, a line (straight
          // or traced) that selects what it crosses, or click to pick features.
          <RadioButtonGroup<SelectTool>
            size="sm"
            value={selectTool}
            onChange={(v) => setSelectTool(v)}
            options={[
              { label: 'Box', value: 'box', description: 'Drag a rectangle' },
              { label: 'Lasso', value: 'lasso', description: 'Draw a freehand outline' },
              { label: 'Line', value: 'line', description: 'Drag a straight line; selects what it crosses' },
              { label: 'Trace', value: 'trace', description: 'Freehand a line along a run of plant' },
              { label: 'Pick', value: 'click', description: 'Click features to add/remove them one at a time' },
            ]}
          />
        )}
        <Button
          size="sm"
          variant={measureMode ? 'primary' : 'secondary'}
          icon="calculator-alt"
          onClick={toggleMeasureMode}
          title="Measure distance along a path (click to add points; Esc/Clear to reset)"
        >
          {measureMode ? 'Measuring…' : 'Measure'}
        </Button>
        {measureMode && <MeasureReadout text={formatDistanceBoth(measureMeters)} onClear={clearMeasure} />}
      </div>
      {options.searchEnabled !== false && (
        <SearchBox
          localSearch={localSearch}
          webSearch={webSearch}
          geocoderEnabled={(options.geocoder ?? 'nominatim') !== 'none'}
          onPick={handlePick}
          onClear={clearSearch}
          placeholder={options.searchPlaceholder}
        />
      )}
      <LayerControl
        layers={controlLayers}
        visibility={effectiveVisibility}
        onToggle={handleToggle}
        onToggleGroup={handleToggleGroup}
        activeLabelView={labelView}
        onSelectLabelView={handleSelectLabelView}
        layerOrder={options.layerOrder ?? { groupOrder: [], itemOrder: [], collapsedGroups: [] }}
      />
      <BasemapControl
        choices={basemapChoices}
        activeIndex={activeBasemapIdx}
        onChange={setActiveBasemapIdx}
      />
      {selection && (
        <SelectionResults
          result={selection}
          // The results window floats over the map and clamps itself to the panel,
          // so it needs the panel size for its initial placement and bounds.
          width={width}
          height={height}
          replaceVariables={replaceVariables}
          onClose={() => {
            setSelection(null);
            clearSelectionHighlight();
            clickSelectedRef.current.clear();
          }}
        />
      )}
    </div>
  );
};

// Theme-aware styling for the MapLibre popup. MapLibre builds the popup outside
// React, so we target its inner elements via a class applied to the popup, and
// override the default white box to match the Grafana theme (works in dark mode).
const getPopupStyles = (theme: GrafanaTheme2) => ({
  popup: css({
    '& .maplibregl-popup-content': {
      background: theme.colors.background.primary,
      color: theme.colors.text.primary,
      borderRadius: '4px',
      padding: theme.spacing(1, 1.5),
      border: `1px solid ${theme.colors.border.weak}`,
      boxShadow: theme.shadows.z2,
    },
    // The little arrow ("tip") — only one side is colored depending on anchor, so
    // set them all to the popup background.
    '& .maplibregl-popup-tip': {
      borderTopColor: theme.colors.background.primary,
      borderBottomColor: theme.colors.background.primary,
      borderLeftColor: theme.colors.background.primary,
      borderRightColor: theme.colors.background.primary,
    },
    '& .maplibregl-popup-close-button': {
      color: theme.colors.text.secondary,
      fontSize: '18px',
      paddingRight: '4px',
    },
  }),
});
