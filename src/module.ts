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
      // --- Vector tile layers ---
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
