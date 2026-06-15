// Panel option types for the Vectormap panel.
//
// Grafana passes these values to the React component as `props.options`. The
// shape declared here MUST stay in sync with the options registered in
// module.ts: Grafana builds the edit-sidebar UI from module.ts, while
// TypeScript checks the component against this interface. Keep both in step.

export interface VectormapOptions {
  // The map view to show when the panel first loads. MapLibre measures position
  // in WGS84 degrees (the same lat/long your data uses) plus a zoom level.
  initialLat: number; // center latitude  (-90 .. 90)
  initialLng: number; // center longitude (-180 .. 180)
  initialZoom: number; // 0 = whole world, ~12 = city, ~18 = building
}
