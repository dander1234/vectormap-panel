// Plugin entry point.
//
// Grafana loads this module and reads the exported `plugin` symbol to register
// the panel. PanelPlugin<VectormapOptions> ties together the options type, the
// React component, and the options-editor controls defined below.

import { PanelPlugin } from '@grafana/data';
import { VectormapOptions, createDefaultLayer } from './types';
import { VectormapPanel } from './components/VectormapPanel';
import { LayersEditor } from './components/LayersEditor';

export const plugin = new PanelPlugin<VectormapOptions>(VectormapPanel).setPanelOptions((builder) => {
  return builder
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
    // --- Vector tile layers ---
    // A custom editor because Grafana's standard builder cannot edit an array of
    // objects. LayersEditor renders the add/remove/configure UI for each layer.
    .addCustomEditor({
      id: 'layers',
      path: 'layers',
      name: 'Vector tile layers',
      description: 'Add one or more MVT layers to render on the map.',
      editor: LayersEditor,
      defaultValue: [createDefaultLayer()],
    });
});
