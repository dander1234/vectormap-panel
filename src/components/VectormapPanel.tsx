// VectormapPanel — the React component that renders the MapLibre GL JS map.
//
// Phase 2 scope: stand up an interactive map with an OpenStreetMap raster
// basemap. There is no data or vector-tile rendering yet; those come in later
// phases. The goal here is just to prove MapLibre lives happily inside a
// Grafana panel and resizes correctly.
//
// The interesting challenge is bridging two different worlds:
//   - React owns the DOM declaratively (you describe what the UI should look
//     like, React updates the page).
//   - MapLibre is imperative (you create a Map object, then call methods on it
//     like map.resize() or map.jumpTo()). It draws into a <canvas> it controls.
//
// We bridge them with two React tools: `useRef` (a stable box that holds a
// value across re-renders without causing them) and `useEffect` (run side
// effects — like creating/destroying the map — at controlled points in the
// component lifecycle).

import React, { useEffect, useRef } from 'react';
import { PanelProps } from '@grafana/data';
import { Button } from '@grafana/ui';
import maplibregl from 'maplibre-gl';
import { VectormapOptions } from '../types';

// MapLibre's stylesheet positions the map canvas and its controls (zoom
// buttons, attribution). Without it the map still draws but the controls are
// mispositioned. webpack's style-loader (configured in .config) injects this
// CSS into the page at runtime when the bundle loads.
import 'maplibre-gl/dist/maplibre-gl.css';

// PanelProps carries everything Grafana gives a panel: options, query data,
// width/height (in pixels), the time range, and more. Typing it with our
// VectormapOptions makes `props.options` strongly typed.
interface Props extends PanelProps<VectormapOptions> {}

export const VectormapPanel: React.FC<Props> = ({ options, onOptionsChange, width, height }) => {
  // Two refs:
  //  - containerRef points at the <div> we hand to MapLibre to draw into.
  //  - mapRef holds the live Map instance so later effects can call methods on
  //    it. We use a ref (not useState) because the map object is not "rendered"
  //    UI — changing it should not trigger a React re-render.
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  // EFFECT 1 — create the map exactly once, on mount.
  //
  // The empty dependency array `[]` means "run this once, after the first
  // render, and never again." We deliberately do NOT recreate the map when
  // options change: tearing down and rebuilding the WebGL context on every edit
  // would flicker and waste resources. Option changes are handled by EFFECT 3,
  // which mutates the existing map instead.
  useEffect(() => {
    // containerRef.current is null until React has painted the div. This effect
    // runs after that first paint, so the div exists — but TypeScript can't
    // know that, hence the guard.
    if (!containerRef.current) {
      return;
    }

    const map = new maplibregl.Map({
      container: containerRef.current,

      // A minimal MapLibre style describing a single OpenStreetMap raster
      // (PNG-tile) basemap. MapLibre usually renders vector styles, but it can
      // also display classic raster tiles — ideal for a simple backdrop. In
      // Phase 3 we'll add vector-tile layers on top of this.
      //
      // We define the style inline here so TypeScript checks it against
      // MapLibre's expected type directly (avoiding the type-widening pitfall a
      // separate typed constant would hit).
      //
      // NOTE: tile.openstreetmap.org is acceptable for light development use,
      // but its tile usage policy forbids heavy/production traffic — swap in
      // your own basemap (e.g. a self-hosted or commercial tile source) before
      // going to production.
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

      // MapLibre takes center as [longitude, latitude] — note the order is the
      // reverse of the usual "lat, long" spoken convention.
      center: [options.initialLng, options.initialLat],
      zoom: options.initialZoom,
    });

    // A small zoom / compass control anchored to the top-right corner.
    map.addControl(new maplibregl.NavigationControl(), 'top-right');

    mapRef.current = map;

    // The function returned from useEffect is its cleanup. React runs it when
    // the component unmounts (panel deleted, dashboard left). Calling
    // map.remove() releases the WebGL context and event listeners, preventing
    // memory leaks as panels mount and unmount over a dashboard's lifetime.
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // We use an empty dependency array on purpose: create the map once only.
    // The effect reads options.initial* values, so the exhaustive-deps lint
    // would want them listed here — but reacting to their changes is EFFECT 3's
    // job, not this one's. Silence the rule for the dependency line below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // EFFECT 2 — keep the map canvas sized to the panel.
  //
  // Grafana re-renders the panel with new width/height props whenever the user
  // resizes it or the dashboard layout reflows. MapLibre does not watch the DOM
  // for size changes on its own, so we must tell it to re-measure its container
  // each time those numbers change. The `?.` safely no-ops if the map isn't
  // created yet.
  useEffect(() => {
    mapRef.current?.resize();
  }, [width, height]);

  // EFFECT 3 — apply edits to the initial-view options to the live map.
  //
  // When the user changes latitude / longitude / zoom in the editor, jump the
  // existing map to the new view rather than recreating it. The dependency
  // array lists exactly the three values this effect reacts to, so it only runs
  // when one of them actually changes.
  useEffect(() => {
    mapRef.current?.jumpTo({
      center: [options.initialLng, options.initialLat],
      zoom: options.initialZoom,
    });
  }, [options.initialLat, options.initialLng, options.initialZoom]);

  // Click handler for the "Set initial view" button. It reads the map's CURRENT
  // center and zoom and persists them as the panel's initial-view options via
  // onOptionsChange (supplied by Grafana in PanelProps). When you're editing the
  // panel, this writes straight into the dashboard model — so after panning to
  // the view you want, one click makes that the saved default. (In view mode it
  // updates only the in-memory model, since nothing is being saved.)
  const handleSetInitialView = () => {
    const map = mapRef.current;
    if (!map) {
      return;
    }
    const center = map.getCenter(); // returns a LngLat: { lng, lat }
    const zoom = map.getZoom();
    onOptionsChange({
      ...options,
      // Round before saving so the dashboard JSON stays tidy. ~6 decimal places
      // of a degree is well under a meter of precision — far more than enough.
      initialLat: Number(center.lat.toFixed(6)),
      initialLng: Number(center.lng.toFixed(6)),
      initialZoom: Number(zoom.toFixed(2)),
    });
  };

  // Layout: an outer box sized to the panel, holding two stacked layers —
  //  1. the map container (absolutely filling the box), and
  //  2. an overlay button in the top-left corner (MapLibre's own controls live
  //     top-right / bottom-right, so the top-left is free).
  // `position: relative` on the outer box anchors both the map's controls and
  // our overlay button to it rather than to the page.
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
