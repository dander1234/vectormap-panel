// Plugin entry point.
//
// Grafana loads this module and reads the exported `plugin` symbol to register
// the panel. PanelPlugin<VectormapOptions> ties together the options type, the
// React component, and the options-editor controls defined below.

import { PanelPlugin } from '@grafana/data';
import { VectormapOptions, createDefaultLayer } from './types';
import { VectormapPanel } from './components/VectormapPanel';
import { LayersEditor } from './components/LayersEditor';
import { MarkerLayersEditor } from './components/MarkerLayersEditor';
import { BasemapChoicesEditor } from './components/BasemapChoicesEditor';
import { LayerOrganizerEditor } from './components/LayerOrganizerEditor';

const VIEW = ['Map view'];
const BASEMAP = ['Basemap'];
const SEARCH = ['Address search'];
const LABELS = ['Point labels'];

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
      .addCustomEditor({
        id: 'layerOrder',
        path: 'layerOrder',
        name: 'Organize layer menu',
        description:
          'Drag to reorder the layer control (categories and layers within a category), and tick a group to start it collapsed on load. Affects the menu only — not map draw order or category membership.',
        defaultValue: { groupOrder: [], itemOrder: [], collapsedGroups: [] },
        editor: LayerOrganizerEditor,
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
      .addCustomEditor({
        id: 'basemapChoices',
        path: 'basemapChoices',
        name: 'Selectable basemaps (viewer switcher)',
        description:
          'Curate basemaps a viewer can switch between on the map. When set, this picker replaces the single Basemap above.',
        defaultValue: [],
        editor: BasemapChoicesEditor,
        category: BASEMAP,
      })
      // --- Address search ---
      .addBooleanSwitch({
        path: 'searchEnabled',
        name: 'Show address search box',
        description: 'A box to jump the map to an address — matching query data first, then a geocoder.',
        defaultValue: true,
        category: SEARCH,
      })
      .addSelect({
        path: 'geocoder',
        name: 'Geocoder',
        description: 'External lookup used when an address is not found in the query data.',
        defaultValue: 'nominatim',
        settings: {
          options: [
            { value: 'nominatim', label: 'Nominatim (OpenStreetMap)' },
            { value: 'custom', label: 'Custom endpoint' },
            { value: 'none', label: 'None (local data only)' },
          ],
        },
        category: SEARCH,
        showIf: (opts) => opts.searchEnabled !== false,
      })
      .addTextInput({
        path: 'geocoderUrl',
        name: 'Custom geocoder URL',
        description:
          'URL template containing {query}. May include ${var} dashboard variables (e.g. an API key — note dashboard JSON is not secret). Should return a GeoJSON FeatureCollection or a Nominatim-style array.',
        defaultValue: '',
        category: SEARCH,
        showIf: (opts) => opts.searchEnabled !== false && opts.geocoder === 'custom',
      })
      .addTextInput({
        path: 'searchPlaceholder',
        name: 'Search box placeholder',
        description: 'Greyed-out hint text shown in the empty search box. Leave blank for the default ("Search address or ID…").',
        defaultValue: '',
        settings: { placeholder: 'Search address or ID…' },
        category: SEARCH,
        showIf: (opts) => opts.searchEnabled !== false,
      })
      // --- Point labels ---
      .addTextInput({
        path: 'glyphsUrl',
        name: 'Glyph (font) server URL',
        description:
          'MapLibre glyph template with {fontstack}/{range} for label text. Blank = built-in default (serves Noto Sans Regular/Bold/Italic). Point at a self-hosted glyph server to use other fonts, then set a marker layer\'s label font family to match.',
        defaultValue: '',
        settings: { placeholder: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf' },
        category: LABELS,
      })
      // --- Marker layers (from query data) ---
      // Markers built from SQL/InfluxDB/… results. Like the tile layers, this is
      // an array of objects, so it needs a custom editor (with a category, or it
      // won't mount — same Grafana quirk as the layers editor below).
      .addCustomEditor({
        category: ['Marker layers (from data)'],
        id: 'markerLayers',
        path: 'markerLayers',
        name: '',
        editor: MarkerLayersEditor,
        defaultValue: [],
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
