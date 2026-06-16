// Panel option types for the Vectormap panel.
//
// Grafana passes these values to the React component as `props.options`. The
// shape here must stay in sync with what module.ts registers (Grafana builds
// the edit UI from module.ts; TypeScript checks the component against these).

// How a vector tile layer's features are drawn.
export type GeometryType = 'line' | 'fill' | 'circle';

// A clickable link shown in a feature's tooltip. The `url` is a TEMPLATE: it may
// contain ${fieldName} placeholders (substituted from the clicked feature's own
// attributes, URL-encoded) and Grafana template variables like ${__from} or your
// dashboard variables (substituted by Grafana). Example:
//   label: "Open in CRM"  url: "https://crm.example.com/cust/${account_id}"
export interface TooltipLink {
  label: string;
  url: string;
  openInNewTab: boolean;
}

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

  // Feature-click tooltip content controls (per layer, since each layer's
  // attributes differ).
  tooltipHideEmpty: boolean; // drop null/blank-valued attributes
  tooltipInclude: string; // case-insensitive regex on field name; '' = all
  tooltipExclude: string; // case-insensitive regex on field name to hide
  tooltipTitleField: string; // field shown as a bold header (optional)
  tooltipLinks: TooltipLink[]; // templated links shown at the bottom of the tooltip
}

// One "marker layer" built from the panel's QUERY data (SQL, InfluxDB, …)
// rather than from vector tiles. Each becomes its own GeoJSON source + circle
// layer and shows up in the on-map layer control exactly like a tile layer, so
// it can be grouped, toggled, and tooltip-formatted independently. This is the
// "lookups as layers" model: one marker layer per query/result set.
export interface MarkerLayerConfig {
  // Stable unique id (React keys + MapLibre source/layer ids). Never shown.
  id: string;
  name: string; // display name (shown in the layer control)
  group: string; // optional group heading in the layer control ('' = ungrouped)
  visible: boolean; // initial visibility

  // Which query to read points from, by its refId (the A/B/C letter in the
  // Query tab). '' = read from every returned frame. Binding a marker layer to
  // one refId lets you have e.g. "Subscribers" (query A) and "ONTs" (query B)
  // as two separate, independently styled layers.
  refId: string;

  latField: string; // field name; '' = auto-detect by common names (lat/latitude/y)
  lngField: string; // field name; '' = auto-detect (lng/long/longitude/lon/x)
  colorField: string; // field whose standard config drives color; '' = fixed color
  fixedColor: string; // used when no color field is chosen
  sizeField: string; // numeric field to scale radius; '' = fixed size
  size: number; // base radius (px); also the min when scaling by a field
  sizeMax: number; // max radius (px) when scaling by sizeField

  // Feature-click tooltip content controls (same model as tile layers).
  tooltipHideEmpty: boolean;
  tooltipInclude: string;
  tooltipExclude: string;
  tooltipTitleField: string;
  tooltipLinks: TooltipLink[];
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

  // Marker layers built from query data (SQL/InfluxDB/…). Drawn above the tile
  // layers; each appears in the layer control alongside them.
  markerLayers: MarkerLayerConfig[];
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
    tooltipHideEmpty: true,
    tooltipInclude: '',
    tooltipExclude: '',
    tooltipTitleField: '',
    tooltipLinks: [],
  };
}

// Factory for a fresh marker layer with sensible defaults and a unique id. Used
// by the marker-layers editor's Add button.
export function createDefaultMarkerLayer(): MarkerLayerConfig {
  return {
    id: 'mlayer-' + Math.random().toString(36).slice(2, 9),
    name: 'New marker layer',
    group: '',
    visible: true,
    refId: '',
    latField: '',
    lngField: '',
    colorField: '',
    fixedColor: '#1f77b4',
    sizeField: '',
    size: 6,
    sizeMax: 18,
    tooltipHideEmpty: true,
    tooltipInclude: '',
    tooltipExclude: '',
    tooltipTitleField: '',
    tooltipLinks: [],
  };
}
