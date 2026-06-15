// Plugin entry point.
//
// Grafana loads this module and reads the exported `plugin` symbol (the name is
// fixed by convention) to register the panel. `PanelPlugin<VectormapOptions>`
// binds three things together: the options type, the React component that
// renders the panel, and the options-editor controls defined below.

import { PanelPlugin } from '@grafana/data';
import { VectormapOptions } from './types';
import { VectormapPanel } from './components/VectormapPanel';

export const plugin = new PanelPlugin<VectormapOptions>(VectormapPanel).setPanelOptions((builder) => {
  // Each `builder.addXxx({...})` call adds one control to the panel's edit
  // sidebar. `path` is the key the value is written to in props.options, so it
  // must match a field in VectormapOptions. `defaultValue` is used until the
  // user changes it. The chained calls return the builder, so we can keep
  // adding controls fluently.
  return builder
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
    });
});
