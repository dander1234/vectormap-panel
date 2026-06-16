// Panel option types for the Vectormap panel.
//
// Grafana passes these values to the React component as `props.options`. The
// shape here must stay in sync with what module.ts registers (Grafana builds
// the edit UI from module.ts; TypeScript checks the component against these).

// How a vector tile layer's features are drawn.
export type GeometryType = 'line' | 'fill' | 'circle';

// Tile Y-axis origin. XYZ = origin top-left (the common web default); TMS =
// origin bottom-left. GeoServer GWC TMS endpoints serve TMS, and MapLibre
// fetches the WRONG tiles unless told scheme: 'tms'.
export type TileScheme = 'xyz' | 'tms';

// Built-in basemap choices (mirrors the defaults Grafana's Geomap offers), plus
// 'none' (overlays on a blank background) and 'custom' (your own XYZ raster URL).
export type BasemapKind = 'osm' | 'carto-light' | 'carto-dark' | 'satellite' | 'none' | 'custom';

// One configurable vector tile (MVT) layer. The panel can show several of these
// at once; each becomes its own MapLibre source + draw layer.
export interface VectorTileLayerConfig {
  // Stable unique id — used for React keys and to derive MapLibre source/layer
  // ids. Generated once when the layer is created; never shown to the user.
  id: string;
  name: string; // display name (shown in the layer control)
  group: string; // optional group heading in the layer control ('' = ungrouped)
  visible: boolean; // initial visibility

  tileUrl: string; // MVT/PBF tile template containing {z}/{x}/{y}
  sourceLayer: string; // the layer name INSIDE the tile (not the GeoServer id)
  tileScheme: TileScheme; // 'tms' for GeoServer GWC TMS endpoints
  geometryType: GeometryType; // line | fill | circle

  // Paint — only the set matching geometryType is used.
  lineColor: string;
  lineWidth: number;
  fillColor: string;
  fillOpacity: number;
  circleColor: string;
  circleRadius: number;

  // Optional MapLibre filter as JSON text, e.g. ["==", "status", "active"].
  filterExpression: string;
}

export interface VectormapOptions {
  // Initial map view (WGS84 degrees + zoom) used when the panel first loads.
  initialLat: number;
  initialLng: number;
  initialZoom: number;

  // Basemap drawn beneath the vector tile layers.
  basemap: BasemapKind;
  basemapUrl: string; // XYZ raster template, used only when basemap === 'custom'

  // The vector tile layers to render, top-most last.
  layers: VectorTileLayerConfig[];
}

// Factory for a fresh layer with sensible defaults and a unique id. Used both by
// module.ts (the default first layer) and the layers editor (the Add button).
// Math.random in the browser is fine here — these ids only need to be unique
// within one panel's option set.
export function createDefaultLayer(): VectorTileLayerConfig {
  return {
    id: 'layer-' + Math.random().toString(36).slice(2, 9),
    name: 'New layer',
    group: '',
    visible: true,
    tileUrl: '',
    sourceLayer: '',
    tileScheme: 'xyz',
    geometryType: 'line',
    lineColor: '#ff5722',
    lineWidth: 2,
    fillColor: '#3388ff',
    fillOpacity: 0.4,
    circleColor: '#1f77b4',
    circleRadius: 5,
    filterExpression: '',
  };
}
