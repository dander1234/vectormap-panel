// Plugin entry point.
//
// Grafana loads this module and reads the exported `plugin` symbol to register
// the panel. PanelPlugin<VectormapOptions> ties together the options type, the
// React component, and the options-editor controls defined below.

import { PanelPlugin } from '@grafana/data';
import { VectormapOptions, createDefaultLayer } from './types';
import { VectormapPanel } from './components/VectormapPanel';
import { LayersEditor } from './components/LayersEditor';

const VIEW = ['Map view'];
const BASEMAP = ['Basemap'];
const MARKERS = ['Markers (from data)'];

export const plugin = new PanelPlugin<VectormapOptions>(VectormapPanel).setPanelOptions((builder) => {
  return (
    builder
      // --- Initial map view ---
      .addNumberInput({
        path: 'initialLat',
        name: 'Initial latitude',
        description: 'Latitude of the map center (WGS84) when the panel loads',
        defaultValue: 0,
        settings: { min: -90, max: 90, step: 0.0001 },
        category: VIEW,
      })
      .addNumberInput({
        path: 'initialLng',
        name: 'Initial longitude',
        description: 'Longitude of the map center (WGS84) when the panel loads',
        defaultValue: 0,
        settings: { min: -180, max: 180, step: 0.0001 },
        category: VIEW,
      })
      .addNumberInput({
        path: 'initialZoom',
        name: 'Initial zoom',
        description: 'MapLibre zoom level (0 = whole world, ~12 = city, ~18 = building)',
        defaultValue: 2,
        settings: { min: 0, max: 22, step: 0.5 },
        category: VIEW,
      })
      // --- Basemap ---
      .addSelect({
        path: 'basemap',
        name: 'Basemap',
        description: 'Background map drawn beneath the vector tile layers.',
        defaultValue: 'osm',
        settings: {
          options: [
            { value: 'osm', label: 'OpenStreetMap' },
            { value: 'carto-light', label: 'CARTO light' },
            { value: 'carto-dark', label: 'CARTO dark' },
            { value: 'satellite', label: 'Satellite (Esri)' },
            { value: 'none', label: 'None (blank)' },
            { value: 'custom', label: 'Custom XYZ URL' },
          ],
        },
        category: BASEMAP,
      })
      .addTextInput({
        path: 'basemapUrl',
        name: 'Custom basemap URL',
        description: 'Raster XYZ template with {z}/{x}/{y}. Used only when Basemap = Custom.',
        defaultValue: '',
        category: BASEMAP,
        showIf: (opts) => opts.basemap === 'custom',
      })
      // --- Markers from query data ---
      .addBooleanSwitch({ path: 'showMarkers', name: 'Show markers', defaultValue: true, category: MARKERS })
      .addFieldNamePicker({
        path: 'latField',
        name: 'Latitude field',
        description: 'Field holding latitude (WGS84). Blank = auto-detect (lat / latitude).',
        category: MARKERS,
      })
      .addFieldNamePicker({
        path: 'lngField',
        name: 'Longitude field',
        description: 'Field holding longitude. Blank = auto-detect (lng / long / longitude).',
        category: MARKERS,
      })
      .addFieldNamePicker({
        path: 'markerColorField',
        name: 'Color by field',
        description: "Marker color from this field's standard config (thresholds / color scheme). Blank = fixed color.",
        category: MARKERS,
      })
      .addColorPicker({ path: 'markerFixedColor', name: 'Fixed color', defaultValue: '#1f77b4', category: MARKERS })
      .addFieldNamePicker({
        path: 'markerSizeField',
        name: 'Size by field',
        description: 'Numeric field to scale marker radius. Blank = fixed size.',
        category: MARKERS,
      })
      .addNumberInput({
        path: 'markerSize',
        name: 'Marker size',
        description: 'Radius in px (base size; the minimum when scaling by a field).',
        defaultValue: 6,
        settings: { min: 1, max: 50, step: 1 },
        category: MARKERS,
      })
      .addNumberInput({
        path: 'markerSizeMax',
        name: 'Max marker size',
        description: 'Maximum radius (px) when scaling by a field.',
        defaultValue: 18,
        settings: { min: 1, max: 80, step: 1 },
        category: MARKERS,
      })
      // --- Vector tile layers ---
      // (Per-layer tooltip controls live inside the LayersEditor.)
      // Custom editor (Grafana's standard builder can't edit an array of objects).
      // A `category` is REQUIRED for a custom editor to mount in Grafana (this is
      // how Grafana's own Geomap registers its layers editor) — without it the
      // editor silently never renders.
      .addCustomEditor({
        category: ['Vector tile layers'],
        id: 'layers',
        path: 'layers',
        name: '',
        editor: LayersEditor,
        defaultValue: [createDefaultLayer()],
      })
  );
});
