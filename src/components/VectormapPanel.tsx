// VectormapPanel — the React component that renders the MapLibre GL JS map.
//
// Bridges React (declarative DOM) and MapLibre (imperative map object) using
// `useRef` (a stable box surviving re-renders) and `useEffect` (side effects at
// controlled lifecycle points). Each effect below is numbered and commented.

import React, { useEffect, useRef, useState } from 'react';
import { PanelProps, GrafanaTheme2 } from '@grafana/data';
import { Button, useStyles2, useTheme2 } from '@grafana/ui';
import { css } from '@emotion/css';
import maplibregl from 'maplibre-gl';
import { VectormapOptions, BasemapKind, VectorTileLayerConfig } from '../types';
import { LayerControl } from './LayerControl';

// MapLibre's stylesheet (positions canvas + controls). webpack's style-loader
// injects it at runtime.
import 'maplibre-gl/dist/maplibre-gl.css';

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
  keyColor: string;
  titleColor: string;
  mutedColor: string;
}

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

  if (!entries.length && !titleHtml) {
    return `<div style="color:${cfg.mutedColor};font-size:12px">No attributes to show</div>`;
  }

  const rows = entries
    .map(
      ([key, value]) =>
        `<tr><td style="padding:2px 12px 2px 0;color:${cfg.keyColor};white-space:nowrap;vertical-align:top">${escapeHtml(
          key
        )}</td><td style="padding:2px 0;vertical-align:top">${escapeHtml(value)}</td></tr>`
    )
    .join('');
  return `${titleHtml}<div style="max-height:260px;overflow:auto"><table style="border-collapse:collapse;font-size:12px;line-height:1.45">${rows}</table></div>`;
};

interface Props extends PanelProps<VectormapOptions> {}

export const VectormapPanel: React.FC<Props> = ({ options, onOptionsChange, width, height }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const theme = useTheme2();
  // Interactivity refs: the open attribute popup, and the highlighted feature.
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const highlightRef = useRef<{ source: string; sourceLayer: string; id: string | number } | null>(null);
  // Theme-aware CSS class for the popup container (see getPopupStyles).
  const popupStyles = useStyles2(getPopupStyles);

  // The click handler is bound once (EFFECT 5), so it reads live data — the layer
  // configs (for per-layer tooltip rules), the themed popup class, and theme
  // colors — through this ref rather than a stale closure.
  const renderRef = useRef<{
    layers: VectorTileLayerConfig[];
    popupClass: string;
    keyColor: string;
    titleColor: string;
    mutedColor: string;
  }>({ layers: [], popupClass: '', keyColor: '#888', titleColor: '#222', mutedColor: '#aaa' });
  useEffect(() => {
    renderRef.current = {
      layers: options.layers ?? [],
      popupClass: popupStyles.popup,
      keyColor: theme.colors.text.secondary,
      titleColor: theme.colors.text.primary,
      mutedColor: theme.colors.text.disabled,
    };
  }, [options.layers, popupStyles.popup, theme]);

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
      const spec = basemapSourceSpec(options.basemap, options.basemapUrl);
      if (!spec) {
        return; // 'none' (or custom with empty URL) — leave just the background
      }
      map.addSource(BASEMAP_SOURCE_ID, spec);
      // Insert below the first overlay so overlays always stay on top.
      const firstVt = (map.getStyle().layers ?? []).find((l) => l.id.startsWith(VT_LAYER_PREFIX))?.id;
      map.addLayer({ id: BASEMAP_LAYER_ID, type: 'raster', source: BASEMAP_SOURCE_ID }, firstVt);
    };
    if (map.isStyleLoaded()) {
      applyBasemap();
    } else {
      map.once('load', applyBasemap);
    }
    return () => {
      map.off('load', applyBasemap);
    };
  }, [options.basemap, options.basemapUrl]);

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

        try {
          map.addSource(sId, { type: 'vector', tiles: [layer.tileUrl], scheme: layer.tileScheme });

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
              map.setFilter(lId, JSON.parse(layer.filterExpression));
            } catch (err) {
              console.warn(`[vectormap] invalid filter for layer "${layer.name}":`, err);
            }
          }
        } catch (err) {
          console.error(`[vectormap] failed to add layer "${layer.name}":`, err);
        }
      }
    };

    if (map.isStyleLoaded()) {
      applyLayers();
    } else {
      map.once('load', applyLayers);
    }
    return () => {
      map.off('load', applyLayers);
    };
  }, [options.layers, theme]);

  // EFFECT 5 — feature interactivity across ALL vector tile layers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }
    const ourLayerIds = (): string[] =>
      (map.getStyle().layers ?? []).map((l) => l.id).filter((id) => id.startsWith(VT_LAYER_PREFIX));

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
      const target = { source: f.source, sourceLayer: f.sourceLayer as string, id: f.id };
      map.setFeatureState(target, { highlighted: true });
      highlightRef.current = target;

      // Resolve the clicked feature's LAYER to pick up its per-layer tooltip rules.
      const layerCfgId = String(f.layer?.id ?? '').slice(VT_LAYER_PREFIX.length);
      const layerCfg = renderRef.current.layers.find((l) => l.id === layerCfgId);
      const cfg: TooltipRenderConfig = {
        hideEmpty: layerCfg?.tooltipHideEmpty ?? true,
        include: layerCfg?.tooltipInclude ?? '',
        exclude: layerCfg?.tooltipExclude ?? '',
        titleField: layerCfg?.tooltipTitleField ?? '',
        keyColor: renderRef.current.keyColor,
        titleColor: renderRef.current.titleColor,
        mutedColor: renderRef.current.mutedColor,
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
  // MapLibre layout property immediately.
  const handleToggle = (layerId: string, visible: boolean) => {
    setVisibility((prev) => ({ ...prev, [layerId]: visible }));
    const map = mapRef.current;
    const lId = layerIdFor(layerId);
    if (map?.getLayer(lId)) {
      map.setLayoutProperty(lId, 'visibility', visible ? 'visible' : 'none');
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

  // Effective visibility shown in the LayerControl = explicit override, else the
  // layer's configured default. Derived during render (no state/effect needed).
  const effectiveVisibility: Record<string, boolean> = {};
  for (const l of options.layers ?? []) {
    effectiveVisibility[l.id] = visibility[l.id] ?? l.visible !== false;
  }

  return (
    <div style={{ width, height, position: 'relative', overflow: 'hidden' }}>
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
      <LayerControl layers={options.layers ?? []} visibility={effectiveVisibility} onToggle={handleToggle} />
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
