# Design notes

Design rationale for notable features, kept so the thinking behind them (and the
parts still deferred) is easy to pick up later. Each section states its current
status.

## Point marker shapes (symbol layers)

**Status: IMPLEMENTED** for marker layers (data markers). Each marker layer has a
`shape` option (circle | square | triangle | diamond | star | cross | hexagon).
`circle` renders as the native circle layer; the others render as **SDF** symbol
icons generated in `src/shapeIcons.ts` (a compact TinySDF port). SDF was chosen
over pre-colored bitmaps specifically so icons stay **data-driven recolorable**
(`icon-color` = the same per-feature `__color` circles use) and so highlight can
recolor to cyan + thicken the white halo via feature-state (paint props).
`icon-size` scales the icon so a marker's diameter matches the equivalent circle.

Why it wasn't trivial: MapLibre has no shape primitives beyond `circle`. Other
shapes require `symbol` layers with `icon-image`, and each image must be
registered on the map via `map.addImage()`. SDF (single-channel distance-field)
images are recolorable via `icon-color`, which is what enables per-feature color
and the recolor-on-highlight; the trade-off is needing a distance transform to
generate them (hence `shapeIcons.ts`).

**Still deferred:**
- Vector-tile `circle` geometry layers don't yet honor a shape (the icon system
  is shared, so it's a small addition — gated on need).
- **User-uploaded custom shapes:** let users supply an SVG/PNG (data URL in
  options, or an uploaded file); `addImage` it and expose as a shape choice.
  Watch panel-options size limits when embedding image data.

## Tooltip (feature popup) content filtering

**Status: IMPLEMENTED.** The feature-click popup is built per layer and supports:

- `tooltipHideEmpty` — drop null/blank-valued attributes.
- `tooltipInclude` — case-insensitive regex on field name (`''` = all fields).
- `tooltipExclude` — case-insensitive regex on field name to hide.
- `tooltipTitleField` — a field shown as a bold header.
- `tooltipLinks` — templated links (`${field}` from the clicked feature plus
  Grafana dashboard variables) shown at the bottom of the tooltip.

These apply to both vector tile layers and marker layers (same model).

**Idless tiles.** The popup is built from `feature.properties` and does not require
a feature id. Marker (GeoJSON) sources get ids from `generateId`, but MVT sources
— notably GeoServer — frequently omit the optional per-feature id, so MapLibre
returns `feature.id === undefined`. The click handler therefore separates the two
concerns via the pure `highlightTargetFor(feature)` helper (in `selection.ts`,
unit-tested): the tooltip always renders, while the feature-state highlight is
applied only when `highlightTargetFor` returns a target (i.e. an id exists). The
**Select area** pipeline already degraded gracefully here — `dedupeKeyFor` falls
back to a properties-derived key when there is no id. The per-layer **ID field**
option (`idField`) closes the gap: when set, the vector source is created with
`promoteId: { [sourceLayer]: idField }`, lifting that property to `feature.id` so
MapLibre populates it. With an id present, `highlightTargetFor` returns a target
(click + selection highlight light up) and `dedupeKeyFor` keys on the real id
(exact de-dup). The field must name a property that is present and unique per
feature in the tile (e.g. a PostGIS primary key surfaced by GeoServer).

**Still deferred:** richer visual styling of the popup table (theme-aware zebra
striping, tighter key/value alignment). The current popup is a readable HTML
attribute table; styling polish is gated on need.

## Configurable basemap providers

**Status: IMPLEMENTED for raster basemaps.** The `basemap` option
(`BasemapKind` in `src/types.ts`) offers: `osm`, `carto-light`, `carto-dark`,
`satellite` (Esri), `none` (overlays on a blank background), and `custom` (your
own XYZ raster URL via `basemapUrl`, with Grafana variable interpolation). Each
preset carries its own attribution.

**Still deferred — vector style-URL basemaps** (MapTiler / OpenMapTiles /
self-hosted `style.json`). The design thinking for when we build it:

1. **Raster vs. vector styles are constructed differently.** A vector style is
   passed to MapLibre as a style URL/object directly; a raster source must be
   wrapped in a minimal style (as we do now). The code needs a branch that builds
   the right `style` for the chosen provider.
2. **`map.setStyle()` REPLACES the entire style** — including our overlay
   tile/marker layers. We must re-add overlay sources/layers after the new style
   loads (`map.once('styledata', …)`), idempotently, on top of whatever basemap
   is active. This is the most important interaction to get right.
3. **API keys.** Providers like MapTiler require a key in the URL. Panel options
   live in the dashboard JSON in plaintext — NOT secret. Recommend users put the
   key in a Grafana template variable and interpolate it, and document that the
   key is not hidden.
4. **Attribution & terms of service.** Carry the correct `attribution` per source
   and respect usage limits (don't hammer free tiles in production).
5. **Layer ordering.** Vector basemaps define many layers; our overlays must be
   inserted above them (and below labels if we want labels on top) via a
   `beforeId`.

## Area selection (box + lasso)

**Status: IMPLEMENTED.** A "Select area" tool returns a list of the features
inside a drawn shape, across **opt-in layers** (each layer has a `selectable`
flag; a layer must also be visible to be queried). Two draw modes share one
pipeline:

- **Box** — drag a rectangle; queried with `map.queryRenderedFeatures(bbox)`.
- **Lasso** — freehand polygon; queried by its bounding box, then refined by
  testing each candidate's projected geometry against the polygon (see
  `featureInLasso` in `src/selection.ts`).

Key design points:

- **Lines count, not just points.** A feature is selected if any vertex is inside
  the polygon OR any of its segments crosses a polygon edge — so plant/fiber
  lines passing through the lasso are caught even with no vertex inside. Points
  must be inside; fills also count a fully-enclosed lasso.
- **Rendered-features scope.** Selection uses `queryRenderedFeatures`, so it sees
  what's drawn at the current zoom/viewport. A future option could do a
  server-side spatial query (GeoServer WFS / SQL) for completeness regardless of
  viewport — deferred.
- **Shared pipeline / seam.** `SelectionGeometry` is a union (`box` | `polygon`);
  `runSelectionQuery` consumes either and produces grouped, de-duplicated results
  (vector tiles repeat a feature per covering tile — deduped by id+sourceLayer).
  The same `selectTooltipFields` helper that builds the click popup picks the
  columns, so the results match each layer's tooltip config.
- **Results window.** A floating, draggable, resizable window
  (`SelectionResults.tsx`) grouped by layer with counts, per-layer cap
  ("showing N of M"), highlight of selected features (existing `highlighted`
  feature-state), and Copy / CSV export.
- **Links in the table.** Each layer's `tooltipLinks` are rendered in the results
  table. A link whose URL has exactly one `${field}` placeholder matching a shown
  column turns that column's cell values into links; links referencing
  multiple/zero fields go in a trailing "Links" column. The URL fill/sanitize
  helpers live in `src/links.ts` and are shared with the click popup
  (`buildPropsTable`) so both render links identically.

**Deferred:** server-side (WFS/SQL) selection for off-screen completeness; richer
result styling; persisting the window position across selections.

## Search (address + account/equipment ID, local-first + geocoder)

**Status: IMPLEMENTED.** A search box jumps the map to a matching point. It
searches **local query data first**, then an external geocoder **on demand** (for
addresses).

- **Local search** (`src/search.ts`, `localFeatureSearch`): matches the query
  (case-insensitive substring) against each marker layer's configured searchable
  fields — `addressField` (text) plus `accountIdField` and `equipmentIdField`
  (numeric IDs). Reads the same data frames the markers are built from (respecting
  each layer's `refId`); instant/in-memory, so it runs as you type. The first
  matching field per row wins and the hit is tagged with which kind matched
  (address / account / equipment), shown in the dropdown. Account/equipment are
  inherently local — only address falls back to the geocoder.
- **External geocoder** (`src/geocode.ts`): only called on an explicit action
  (Enter / "Search web") to respect provider rate limits. Default is **Nominatim**
  (OpenStreetMap, no key — keep volume low + attribute OSM). A **custom** endpoint
  is a URL template with `{query}` (and `${var}` interpolation for keys); the
  tolerant `parseGeocodeResults` accepts a GeoJSON FeatureCollection or a
  Nominatim-style array. **None** disables web lookups. Google was rejected: paid,
  and its ToS forbids showing its geocoding results on a non-Google basemap.
- **Pick → fly + pin + popup** (`handlePick` in VectormapPanel): `flyTo`
  (or `fitBounds` for a result bbox), a `search-pin` GeoJSON ring layer, and a
  popup — local hits reuse `buildPropsTable` with that layer's tooltip config; web
  hits show the geocoded label. The box's ✕ clears the pin/popup.
- **Placeholder** (`searchPlaceholder` option): the empty box's greyed-out hint is
  configurable; `SearchBox` falls back to the built-in default when it's blank or
  whitespace, so panels saved before this option are unaffected.

**Deferred:** geocoder typeahead/autocomplete; reverse geocoding (click → address);
searching vector-tile rendered features; persisting the last search.
