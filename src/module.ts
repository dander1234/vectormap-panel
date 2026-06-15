// Plugin entry point.
//
// Grafana loads this module and reads the exported `plugin` symbol (the name is
// fixed by convention) to register the panel. `PanelPlugin<VectormapOptions>`
// binds three things together: the options type, the React component that
// renders the panel, and the options-editor controls defined below.

import { PanelPlugin } from '@grafana/data';
import { VectormapOptions } from './types';
import { VectormapPanel } from './components/VectormapPanel';

// Group the vector-tile controls under one collapsible section in the editor.
const LAYER_CATEGORY = ['Vector tile layer'];

export const plugin = new PanelPlugin<VectormapOptions>(VectormapPanel).setPanelOptions((builder) => {
  // Each `builder.addXxx({...})` call adds one control to the panel's edit
  // sidebar. `path` is the key the value is written to in props.options, so it
  // must match a field in VectormapOptions. `category` puts the control inside a
  // named, collapsible group. `showIf` hides a control unless a condition on the
  // current options holds. The chained calls return the builder so we keep
  // adding fluently.
  return (
    builder
      // --- Initial map view ---
      .addNumberInput({
        path: 'initialLat',
        name: 'Initial latitude',
        description: 'Latitude of the map center (WGS84) when the panel loads',
        defaultValue: 0,
        settings: { min: -90, max: 90, step: 0.0001 },
      })
      .addNumberInput({
        path: 'initialLng',
        name: 'Initial longitude',
        description: 'Longitude of the map center (WGS84) when the panel loads',
        defaultValue: 0,
        settings: { min: -180, max: 180, step: 0.0001 },
      })
      .addNumberInput({
        path: 'initialZoom',
        name: 'Initial zoom',
        description: 'MapLibre zoom level (0 = whole world, ~12 = city, ~18 = building)',
        defaultValue: 2,
        settings: { min: 0, max: 22, step: 0.5 },
      })

      // --- Vector tile layer ---
      .addTextInput({
        path: 'tileUrl',
        name: 'Tile URL',
        description: 'MVT/PBF tile template containing {z}/{x}/{y}. e.g. a GeoServer GWC pbf endpoint.',
        defaultValue: '',
        category: LAYER_CATEGORY,
      })
      .addTextInput({
        path: 'sourceLayer',
        name: 'Source layer',
        description:
          'The layer name INSIDE the vector tile — not the GeoServer layer id. For GeoServer this is usually the published layer name (e.g. "northridge_fiber").',
        defaultValue: '',
        category: LAYER_CATEGORY,
      })
      .addRadio({
        path: 'tileScheme',
        name: 'Tile scheme',
        description:
          'Tile Y-axis origin. XYZ (top-left) is the common web default. GeoServer GWC TMS endpoints are TMS (bottom-left) — set this to TMS or the map fetches the WRONG tiles.',
        defaultValue: 'xyz',
        settings: {
          options: [
            { value: 'xyz', label: 'XYZ' },
            { value: 'tms', label: 'TMS' },
          ],
        },
        category: LAYER_CATEGORY,
      })
      .addRadio({
        path: 'geometryType',
        name: 'Geometry type',
        description: 'Draw the features as lines or as polygon fills.',
        defaultValue: 'line',
        settings: {
          options: [
            { value: 'line', label: 'Line' },
            { value: 'fill', label: 'Fill' },
          ],
        },
        category: LAYER_CATEGORY,
      })
      // Line paint — only shown for line geometry.
      .addColorPicker({
        path: 'lineColor',
        name: 'Line color',
        defaultValue: '#ff5722',
        category: LAYER_CATEGORY,
        showIf: (opts) => opts.geometryType === 'line',
      })
      .addSliderInput({
        path: 'lineWidth',
        name: 'Line width',
        defaultValue: 2,
        settings: { min: 0, max: 20, step: 0.5 },
        category: LAYER_CATEGORY,
        showIf: (opts) => opts.geometryType === 'line',
      })
      // Fill paint — only shown for fill geometry.
      .addColorPicker({
        path: 'fillColor',
        name: 'Fill color',
        defaultValue: '#3388ff',
        category: LAYER_CATEGORY,
        showIf: (opts) => opts.geometryType === 'fill',
      })
      .addSliderInput({
        path: 'fillOpacity',
        name: 'Fill opacity',
        defaultValue: 0.4,
        settings: { min: 0, max: 1, step: 0.05 },
        category: LAYER_CATEGORY,
        showIf: (opts) => opts.geometryType === 'fill',
      })
      .addTextInput({
        path: 'filterExpression',
        name: 'Filter (advanced)',
        description:
          'Optional MapLibre filter as JSON, e.g. ["==", "status", "active"]. Leave blank for no filter.',
        defaultValue: '',
        category: LAYER_CATEGORY,
      })
  );
});
