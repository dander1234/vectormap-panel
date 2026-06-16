// VectormapPanel — the React component that renders the MapLibre GL JS map.
//
// Bridges two worlds: React owns the DOM declaratively, while MapLibre is
// imperative (create a Map, then call methods on it). We bridge with `useRef`
// (a stable box surviving re-renders) and `useEffect` (run side effects at
// controlled lifecycle points). Each effect below is numbered and commented.

import React, { useEffect, useRef } from 'react';
import { PanelProps } from '@grafana/data';
import { Button, useTheme2 } from '@grafana/ui';
import maplibregl from 'maplibre-gl';
import { VectormapOptions } from '../types';

// MapLibre's stylesheet (positions canvas + controls). webpack's style-loader
// injects it at runtime.
import 'maplibre-gl/dist/maplibre-gl.css';

// Each configured layer becomes a MapLibre source + draw layer. We derive their
// ids from the layer's stable id, and use the prefixes to find "our" layers
// (versus the basemap) when rebuilding or handling clicks.
const VT_SOURCE_PREFIX = 'vt-src-';
const VT_LAYER_PREFIX = 'vt-layer-';
const sourceIdFor = (layerId: string) => VT_SOURCE_PREFIX + layerId;
const layerIdFor = (layerId: string) => VT_LAYER_PREFIX + layerId;

// Color used to draw a clicked/selected feature.
const HIGHLIGHT_COLOR = '#00e5ff';

// Build a paint expression: use `highlightValue` when the feature is selected
// (feature-state 'highlighted' is true), else `normalValue`. Returns `any` to
// sidestep MapLibre's strict expression typing — the value is a valid MapLibre
// expression at runtime.
const whenHighlighted = (highlightValue: unknown, normalValue: unknown): any => [
  'case',
  ['boolean', ['feature-state', 'highlighted'], false],
  highlightValue,
  normalValue,
];

// Escape untrusted attribute text before inserting into popup HTML.
const escapeHtml = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// Build a scrollable attribute table from a feature's MVT properties.
const buildPropsTable = (props: Record<string, unknown>): string => {
  const rows = Object.entries(props)
    .map(
      ([k, v]) =>
        `<tr><td style="padding:1px 6px 1px 0;color:#888;white-space:nowrap;vertical-align:top">${escapeHtml(
          k
        )}</td><td style="padding:1px 0">${escapeHtml(v)}</td></tr>`
    )
    .join('');
  return `<div style="max-height:240px;overflow:auto;font-size:11px;line-height:1.35"><table style="border-collapse:collapse">${rows}</table></div>`;
};

interface Props extends PanelProps<VectormapOptions> {}

export const VectormapPanel: React.FC<Props> = ({ options, onOptionsChange, width, height }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  // Theme: resolves color-picker values (which may be named palette colors like
  // 'dark-red', not CSS) into real CSS colors MapLibre can parse.
  const theme = useTheme2();
  // Interactivity refs: the open attribute popup, and the highlighted feature.
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const highlightRef = useRef<{ source: string; sourceLayer: string; id: string | number } | null>(null);

  // EFFECT 1 — create the map exactly once, on mount. The empty deps array means
  // "run once". We never recreate the map on option change (that would flicker);
  // other effects mutate the existing map instead.
  useEffect(() => {
    if (!containerRef.current) {
      return;
    }
    const map = new maplibregl.Map({
      container: containerRef.current,
      // Minimal OSM raster basemap. (Selectable basemaps are a planned feature.)
      // tile.openstreetmap.org is fine for light dev use only — see its usage
      // policy before production.
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors',
          },
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
      },
      // MapLibre center is [longitude, latitude] — reverse of spoken order.
      center: [options.initialLng, options.initialLat],
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

  // EFFECT 2 — keep the canvas sized to the panel (MapLibre doesn't auto-watch).
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

  // EFFECT 4 — (re)build every configured vector tile layer.
  //
  // Strategy: on any layer-config change, remove all of OUR sources/layers (by
  // prefix) and add the current set fresh. Simple and correct; the trade-off is
  // that editing one layer re-adds them all (tiles re-fetch, largely from cache).
  // Must wait for the basemap style to load before adding sources.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    const applyLayers = () => {
      // Tear down our previous layers (remove layers before their sources).
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
      // Any open popup/highlight referred to the old layers — clear it.
      popupRef.current?.remove();
      popupRef.current = null;
      highlightRef.current = null;

      for (const layer of options.layers ?? []) {
        // Skip layers that aren't configured enough to draw.
        if (!layer.tileUrl || !layer.sourceLayer) {
          continue;
        }
        const sId = sourceIdFor(layer.id);
        const lId = layerIdFor(layer.id);
        // Resolve picker colors to real CSS, with fallbacks for unset values.
        const lineColor = theme.visualization.getColorByName(layer.lineColor ?? '#ff5722');
        const fillColor = theme.visualization.getColorByName(layer.fillColor ?? '#3388ff');
        const circleColor = theme.visualization.getColorByName(layer.circleColor ?? '#1f77b4');
        const lineWidth = layer.lineWidth ?? 2;
        const fillOpacity = layer.fillOpacity ?? 0.4;
        const circleRadius = layer.circleRadius ?? 5;
        const visibility: 'visible' | 'none' = layer.visible === false ? 'none' : 'visible';

        try {
          map.addSource(sId, {
            type: 'vector',
            tiles: [layer.tileUrl], // {z}/{x}/{y} template; variable interpolation = Phase 6
            scheme: layer.tileScheme, // 'tms' flips Y for GeoServer GWC TMS
          });

          if (layer.geometryType === 'fill') {
            map.addLayer({
              id: lId,
              type: 'fill',
              source: sId,
              'source-layer': layer.sourceLayer,
              layout: { visibility },
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
              layout: { visibility },
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
              layout: { visibility, 'line-cap': 'round', 'line-join': 'round' },
              paint: {
                'line-color': whenHighlighted(HIGHLIGHT_COLOR, lineColor),
                'line-width': whenHighlighted(lineWidth + 3, lineWidth),
              },
            });
          }

          // Optional per-layer filter (JSON). Invalid → warn, keep the layer.
          if (layer.filterExpression?.trim()) {
            try {
              map.setFilter(lId, JSON.parse(layer.filterExpression));
            } catch (err) {
              // eslint-disable-next-line no-console
              console.warn(`[vectormap] invalid filter for layer "${layer.name}":`, err);
            }
          }
        } catch (err) {
          // eslint-disable-next-line no-console
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
  //
  // Bound once. At event time it reads the current set of "our" layer ids from
  // the live style, so it works no matter how many layers exist or how they
  // change. The clicked feature carries its own source/sourceLayer/id, so the
  // highlight logic needs no option values.
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
        return; // clicked empty space — selection already cleared
      }
      const target = { source: f.source, sourceLayer: f.sourceLayer as string, id: f.id };
      map.setFeatureState(target, { highlighted: true });
      highlightRef.current = target;

      const popup = new maplibregl.Popup({ maxWidth: '340px', closeOnClick: false })
        .setLngLat(e.lngLat)
        .setHTML(buildPropsTable(f.properties ?? {}))
        .addTo(map);
      popup.on('close', clearHighlight);
      popupRef.current = popup;
    };

    // Pointer cursor when hovering any of our features.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "Set initial view" button: capture the map's current center/zoom and persist
  // them as the panel's initial-view options via onOptionsChange.
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
    </div>
  );
};
