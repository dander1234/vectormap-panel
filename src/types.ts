// Panel option types for the Vectormap panel.
//
// Grafana passes these values to the React component as `props.options`. The
// shape declared here MUST stay in sync with the options registered in
// module.ts: Grafana builds the edit-sidebar UI from module.ts, while
// TypeScript checks the component against this interface. Keep both in step.

// How a vector tile layer's features should be drawn.
export type GeometryType = 'line' | 'fill';

// Tile Y-axis origin convention. XYZ has its origin top-left (the common web
// default); TMS has it bottom-left. GeoServer's GWC TMS endpoints serve TMS, and
// MapLibre fetches the WRONG tiles unless told scheme: 'tms'.
export type TileScheme = 'xyz' | 'tms';

export interface VectormapOptions {
  // --- Initial map view (used when the panel first loads) ---
  // MapLibre measures position in WGS84 degrees (same as your data) + a zoom.
  initialLat: number; // center latitude  (-90 .. 90)
  initialLng: number; // center longitude (-180 .. 180)
  initialZoom: number; // 0 = whole world, ~12 = city, ~18 = building

  // --- Vector tile layer (Phase 3: a single configurable MVT layer) ---
  // Multiple layers come later via a custom list editor; for now this is one
  // layer whose config lives in these flat fields.
  tileUrl: string; // MVT/PBF tile template containing {z}/{x}/{y}
  sourceLayer: string; // the layer name INSIDE the tile (not the GeoServer id)
  tileScheme: TileScheme; // 'tms' for GeoServer GWC TMS endpoints
  geometryType: GeometryType; // draw features as lines or polygon fills

  // Line paint (used when geometryType === 'line')
  lineColor: string;
  lineWidth: number;

  // Fill paint (used when geometryType === 'fill')
  fillColor: string;
  fillOpacity: number;

  // Optional MapLibre filter expression, entered as JSON text (advanced).
  // Example: ["==", "status", "active"]. Empty string = no filter.
  filterExpression: string;
}
