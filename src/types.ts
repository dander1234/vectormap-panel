// Panel option types for the Vectormap panel.
//
// Grafana passes these values to the React component as `props.options`. The
// shape here must stay in sync with what module.ts registers (Grafana builds
// the edit UI from module.ts; TypeScript checks the component against these).

import { GeocoderKind } from './geocode';

// How a vector tile layer's features are drawn.
export type GeometryType = 'line' | 'fill' | 'circle';

// Point marker shapes. 'circle' renders as a native MapLibre circle layer; the
// rest render as SDF symbol icons (see shapeIcons.ts). Used by marker layers.
export type MarkerShape = 'circle' | 'square' | 'triangle' | 'diamond' | 'star' | 'cross' | 'hexagon';

// How a marker layer decides each point's color:
//  - 'fixed'      : always the layer's fixed color.
//  - 'field'      : the chosen field's Grafana standard config (value mappings /
//                   thresholds / color scheme) via field.display — the original
//                   behavior; configure it in the panel's Field/Overrides tab.
//  - 'thresholds' : explicit numeric thresholds defined ON THIS LAYER (below) —
//                   the highest threshold ≤ the value wins.
//  - 'regex'      : explicit regex rules defined on this layer — first pattern
//                   that matches the (string) value wins.
export type MarkerColorMode = 'fixed' | 'field' | 'thresholds' | 'regex';

// One color rule for the 'thresholds' / 'regex' color modes. `match` is a numeric
// threshold (as text) for thresholds, or a regex pattern for regex mode.
export interface MarkerColorRule {
  match: string;
  color: string;
}

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

// One selectable "label view" for a marker layer. Lets a viewer re-display the
// same points as text pulled from the data — e.g. { name: 'Address', field:
// 'address' } shows each point's address beside its dot. `name` is what appears
// in the on-map view dropdown; `field` is the data column rendered as the label.
export interface MarkerLabelView {
  name: string;
  field: string;
}

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

  // Whether this layer takes part in the "Select area" tool. When true (the
  // default), drawing a box queries this layer's rendered features — but only if
  // the layer is also currently visible. Turn off to keep a layer on the map yet
  // out of selections (e.g. a noisy or very dense layer). Read as
  // `selectable !== false` everywhere so panels saved before this option existed
  // still default to selectable.
  selectable: boolean;

  tileUrl: string; // MVT/PBF tile template containing {z}/{x}/{y}
  sourceLayer: string; // the layer name INSIDE the tile (not the GeoServer id)
  tileScheme: TileScheme; // 'tms' for GeoServer GWC TMS endpoints
  geometryType: GeometryType; // line | fill | circle

  // Optional name of a feature PROPERTY to promote to the feature id (MapLibre
  // `promoteId`). Many MVT sources — notably GeoServer — ship features with no
  // per-feature id, which disables click/selection HIGHLIGHTING (feature-state is
  // keyed on the id) and makes Select-area fall back to attribute-based de-dup.
  // Point this at a unique column the tile carries (e.g. 'gid' / 'fid' / a primary
  // key) to restore exact highlighting and de-dup. '' = leave ids as-is.
  idField: string;

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

  // Whether this marker layer takes part in the "Select area" tool (same meaning
  // as on tile layers — selectable AND visible to be included). Default true.
  selectable: boolean;

  // Which query to read points from, by its refId (the A/B/C letter in the
  // Query tab). '' = read from every returned frame. Binding a marker layer to
  // one refId lets you have e.g. "Subscribers" (query A) and "ONTs" (query B)
  // as two separate, independently styled layers.
  refId: string;

  shape: MarkerShape; // marker shape (circle | square | triangle | …)
  // Fields searched by the on-map search box. Each is '' = not searchable.
  // addressField is text (street address); accountIdField / equipmentIdField are
  // numeric IDs. A search-box query is matched (case-insensitive substring)
  // against whichever of these are set, and a match flies to + pins that point.
  addressField: string;
  accountIdField: string;
  equipmentIdField: string;
  latField: string; // field name; '' = auto-detect by common names (lat/latitude/y)
  lngField: string; // field name; '' = auto-detect (lng/long/longitude/lon/x)
  colorMode: MarkerColorMode; // how color is decided (fixed | field | thresholds | regex)
  colorField: string; // field read for color (field/thresholds/regex modes)
  colorRules: MarkerColorRule[]; // thresholds/regex rules (used by those modes)
  fixedColor: string; // 'fixed' mode color, and the fallback for every mode
  sizeField: string; // numeric field to scale radius; '' = fixed size
  size: number; // base radius (px); also the min when scaling by a field
  sizeMax: number; // max radius (px) when scaling by sizeField

  // Feature-click tooltip content controls (same model as tile layers).
  tooltipHideEmpty: boolean;
  tooltipInclude: string;
  tooltipExclude: string;
  tooltipTitleField: string;
  tooltipLinks: TooltipLink[];

  // Optional "label views" a viewer can switch between on the map (in addition to
  // the always-available "Markers" view = the colored dot only). Each view shows
  // the named field's value as a text label beside each point. '' or [] = no view
  // dropdown for this layer (points draw as shapes only, the original behavior).
  labelViews: MarkerLabelView[];
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

  // Address search box. When enabled, a search box lets the user jump to an
  // address — matching local query data first (per a layer's addressField) and
  // falling back to the external geocoder on demand.
  searchEnabled: boolean;
  geocoder: GeocoderKind; // 'nominatim' | 'custom' | 'none' (local-only)
  geocoderUrl: string; // custom endpoint template with {query}; used when geocoder==='custom'
  // Greyed-out hint text shown in the empty search box. '' (or unset) falls back
  // to the built-in default ("Search address or ID…"). Lets a deployment word the
  // box for its own data, e.g. "Find an ONT or account".
  searchPlaceholder: string;
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
    selectable: true,
    tileUrl: '',
    sourceLayer: '',
    tileScheme: 'xyz',
    geometryType: 'line',
    idField: '',
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
    selectable: true,
    refId: '',
    shape: 'circle',
    addressField: '',
    accountIdField: '',
    equipmentIdField: '',
    latField: '',
    lngField: '',
    colorMode: 'field',
    colorField: '',
    colorRules: [],
    fixedColor: '#1f77b4',
    sizeField: '',
    size: 6,
    sizeMax: 18,
    tooltipHideEmpty: true,
    tooltipInclude: '',
    tooltipExclude: '',
    tooltipTitleField: '',
    tooltipLinks: [],
    labelViews: [],
  };
}
