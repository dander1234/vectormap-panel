// VectormapPanel — the React component that renders the MapLibre GL JS map.
//
// Bridges React (declarative DOM) and MapLibre (imperative map object) using
// `useRef` (a stable box surviving re-renders) and `useEffect` (side effects at
// controlled lifecycle points). Each effect below is numbered and commented.

import React, { useEffect, useRef, useState } from 'react';
import { PanelProps, GrafanaTheme2, DataFrame } from '@grafana/data';
import { Button, useStyles2, useTheme2 } from '@grafana/ui';
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
import { ensureShapeIcon, iconIdForShape, SHAPE_ICON_EFFECTIVE } from '../shapeIcons';
import { MAPLIBRE_CSS } from '../maplibreCss';

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
const mkSourceIdFor = (id: string) => MK_SOURCE_PREFIX + id;
const mkLayerIdFor = (id: string) => MK_LAYER_PREFIX + id;
const LAT_NAMES = ['latitude', 'lat', 'y'];
const LNG_NAMES = ['longitude', 'long', 'lng', 'lon', 'x'];

// Color used to draw a clicked/selected feature.
const HIGHLIGHT_COLOR = '#00e5ff';

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

// Reject dangerous URL schemes; allow http(s), mailto, tel, and relative URLs.
const sanitizeUrl = (url: string): string | null => {
  const u = url.trim();
  if (!u || /^\s*(javascript|data|vbscript):/i.test(u)) {
    return null;
  }
  return u;
};

// Build a link URL from its template: first substitute ${field} placeholders
// from the clicked feature's own attributes (URL-encoded), then run Grafana's
// variable interpolation for any remaining ${var} (dashboard variables).
const fillUrl = (tpl: string, props: Record<string, unknown>, replaceVariables: (s: string) => string): string => {
  const withFields = tpl.replace(/\$\{([\w.]+)\}/g, (m, key) =>
    Object.prototype.hasOwnProperty.call(props, key) ? encodeURIComponent(String(props[key] ?? '')) : m
  );
  return replaceVariables(withFields);
};

// Compile a user regex, returning null on blank/invalid (so a bad regex never
// breaks the popup).
const compileRegex = (src: string): RegExp | null => {
  if (!src || !src.trim()) {
    return null;
  }
  try {
    return new RegExp(src, 'i');
  } catch {
    return null;
  }
};

const isEmptyValue = (v: unknown): boolean => v === null || v === undefined || String(v).trim() === '';

// Build the popup HTML: an optional bold title + a filtered attribute table.
const buildPropsTable = (props: Record<string, unknown>, cfg: TooltipRenderConfig): string => {
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

  let titleHtml = '';
  if (cfg.titleField) {
    const titleValue = props[cfg.titleField];
    if (!isEmptyValue(titleValue)) {
      titleHtml = `<div style="font-weight:600;font-size:13px;margin-bottom:6px;color:${cfg.titleColor}">${escapeHtml(
        titleValue
      )}</div>`;
      entries = entries.filter(([key]) => key !== cfg.titleField); // don't repeat it below
    }
  }

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

  // Interpolated custom basemap URL (see EFFECT B deps note below).
  const basemapUrlInterp = replaceVariables(options.basemapUrl ?? '');

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
      const spec = basemapSourceSpec(options.basemap, basemapUrlInterp);
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
    // Depend on the INTERPOLATED url (not the raw template) so swapping a
    // dashboard variable re-runs this effect — options identity is unchanged then.
  }, [options.basemap, basemapUrlInterp]);

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
          map.addSource(sId, { type: 'vector', tiles: [tileUrl], scheme: layer.tileScheme });

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
          } else {
            map.addLayer({
              id: lId,
              type: 'line',
              source: sId,
              'source-layer': layer.sourceLayer,
              layout: { visibility: vis, 'line-cap': 'round', 'line-join': 'round' },
              paint: {
                'line-color': whenHighlighted(HIGHLIGHT_COLOR, lineColor),
                'line-width': whenHighlighted(lineWidth + 3, lineWidth),
              },
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
      // Keep all marker layers above the (re-added) vector tile overlays.
      (map.getStyle().layers ?? []).forEach((l) => {
        if (l.id.startsWith(MK_LAYER_PREFIX)) {
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

      // Drop marker layers/sources whose config was removed.
      const style = map.getStyle();
      (style.layers ?? []).forEach((l) => {
        if (l.id.startsWith(MK_LAYER_PREFIX) && !desiredLayerIds.has(l.id)) {
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
      const ids = ourLayerIds();
      clearHighlight();
      popupRef.current?.remove();
      popupRef.current = null;
      if (!ids.length) {
        return;
      }
      const f = map.queryRenderedFeatures(e.point, { layers: ids })[0];
      if (!f || f.id === undefined) {
        return;
      }
      // GeoJSON sources (markers) have no sourceLayer; vector sources need it.
      const target: { source: string; sourceLayer?: string; id: string | number } = { source: f.source, id: f.id };
      if (f.sourceLayer) {
        target.sourceLayer = f.sourceLayer;
      }
      map.setFeatureState(target, { highlighted: true });
      highlightRef.current = target;

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
  }, []);

  // Toggle a layer's visibility from the LayerControl: update state + flip the
  // MapLibre layout property immediately. The id may belong to a tile layer or a
  // marker layer (different MapLibre layer-id prefixes), so flip whichever exists.
  const handleToggle = (layerId: string, visible: boolean) => {
    setVisibility((prev) => ({ ...prev, [layerId]: visible }));
    const map = mapRef.current;
    if (!map) {
      return;
    }
    const vis: 'visible' | 'none' = visible ? 'visible' : 'none';
    const vtId = layerIdFor(layerId);
    const mkId = mkLayerIdFor(layerId);
    if (map.getLayer(vtId)) {
      map.setLayoutProperty(vtId, 'visibility', vis);
    }
    if (map.getLayer(mkId)) {
      map.setLayoutProperty(mkId, 'visibility', vis);
    }
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
        // Legend icon matches the geometry: line=bar, fill=square, circle=dot.
        shape: (l.geometryType === 'fill' ? 'square' : l.geometryType === 'circle' ? 'circle' : 'line') as LegendShape,
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
      <div style={{ position: 'absolute', top: 8, left: 8, zIndex: 1 }}>
        <Button
          size="sm"
          variant="secondary"
          onClick={handleSetInitialView}
          title="Save the map's current center and zoom as this panel's initial view"
        >
          Set initial view
        </Button>
      </div>
      <LayerControl layers={controlLayers} visibility={effectiveVisibility} onToggle={handleToggle} />
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
