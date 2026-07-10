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

## Layer control: group toggle + point label views

**Status: IMPLEMENTED.**

- **Group toggle.** Each named group heading in `LayerControl` carries a checkbox
  that toggles all its layers. The tri-state math is the pure `groupCheckState(ids,
  visibility)` helper (`src/layerControl.ts`, unit-tested) → `'on' | 'off' |
  'mixed'`; the `mixed` state is applied to the DOM input's `indeterminate` via a
  ref (not a React prop). `handleToggleGroup` batches one `setVisibility` and
  applies each layer's MapLibre visibility, reusing the per-layer path.

- **Point label views.** A marker layer's `labelViews: {name, field}[]` (options)
  are viewer-selectable text labels. Each marker layer gets a SECOND MapLibre
  symbol layer (`mk-label-<id>`, distinct prefix so it's excluded from click and
  Select-area hit-testing — clicks fall through to the dot). The active view is
  runtime-only state (`labelView`/`labelViewRef`, mirroring `visibility`); the
  label layer's `text-field` is set to `['to-string', ['get', field]]` (to-string
  guards numeric fields) and shown only when a view is active AND the layer is
  visible. The colored dot is always kept as the anchor. `text-allow-overlap:false`
  + `text-optional:true` declutter the labels.

  **Label formatting:** each marker layer carries `labelTextSize`, `labelTextColor`,
  `labelHaloColor`, `labelHaloWidth`, `labelFontFamily`, `labelFontStyle` (blank
  colors resolve to the theme). These are applied to the label symbol layer's
  `text-size`/`text-color`/`text-halo-*`/`text-font` on every `applyMarkers` run so
  edits take effect live. `text-font` is composed by `labelFont(family, style)` →
  e.g. `['Noto Sans Bold']`; the stack MUST be served by the glyph endpoint.

  **Glyphs dependency:** MapLibre needs a `glyphs` URL to render ANY text. The
  `glyphsUrl` option (default `demotiles.maplibre.org/font/{fontstack}/{range}.pbf`,
  which serves Noto Sans Regular/Bold/Italic) is applied at map init and kept live
  by EFFECT G via `map.setGlyphs`. Point it at a self-hosted glyph server to use
  other typefaces (then set a layer's `labelFontFamily` to match). If unreachable,
  labels just don't render; the rest of the map is unaffected. NOTE:
  `fonts.openmaptiles.org` was retired to an HTML landing page and no longer serves
  fonts — do not use it.

  **Collapsible groups:** the `LayerControl` keeps a local `collapsed` map (per
  group name, runtime-only). A chevron/name click toggles it; collapsed groups hide
  their layer rows. Independent of the group show/hide checkbox.

  **Menu ordering:** the `layerOrder` option (`{ groupOrder, itemOrder,
  collapsedGroups }`, edited by the drag-and-drop `LayerOrganizerEditor`) is pure
  display metadata keyed by group name / layer id. `LayerControl` applies order with
  the stable `orderByKey` helper (`layerControl.ts`, unit-tested) — listed keys
  first, unlisted keep their first-seen/array order, stale keys ignored — so empty
  metadata renders exactly as before and it survives layers being
  added/removed/regrouped. It deliberately does NOT touch the `layers`/`markerLayers`
  arrays, so map draw/z-order is unaffected; category membership stays each layer's
  `group` field (no drag-between-groups). The organizer reads the live layers via
  `context.options` and native HTML5 DnD (no added dependency). `collapsedGroups`
  seeds each group's initial collapsed state (a group with no runtime toggle follows
  it); a per-group "Collapsed" checkbox in the organizer edits it.

## Marker icon library

**Status: IMPLEMENTED.** `src/icons.ts` is the single registry (`MarkerIcon`
`{ id, name, category, keywords, path, fillRule? }`) used by BOTH the map and the
legend. Each icon is a **monochrome silhouette** in a 24×24 viewBox — monochrome is
required so MapLibre can recolor it per feature via `icon-color`
(color-by-data / status / highlight). `shapeIcons.ts` rasterizes an icon's SVG
`path` with `Path2D` (scaled into `SHAPE_ICON_EFFECTIVE`, filled with its
`fillRule`) and runs the existing EDT → SDF pipeline; `'circle'` stays a native
circle layer, unknown ids fall back to the square. The legend `ShapeSwatch`
(`LayerControl.tsx`) renders the same `path` as an `<svg>`. The picker
(`IconPicker.tsx`) is a search-over-grid popover (`searchIcons`, matching name +
keywords, grouped by category). `MarkerShape` is now a string icon id; the 7
original geometric ids are kept for back-compat. Multi-color/photographic icons are
out of scope (they can't recolor).

**Vector tile layers** reuse the same machinery: a `circle`-geometry layer with an
`icon` set renders as an SDF `symbol` layer (via `ensureShapeIcon`/`iconIdForShape`,
recolored by `icon-color`) instead of a native circle. `line` layers take a
`lineStyle` mapped to a `line-dasharray` (solid omits it; dotted/dash-dot use the
round `line-cap` for the dots). Dashes can't be data-driven in MapLibre, so
per-attribute distinction (underground vs overhead) is done with a per-layer filter
+ style, the same pattern as per-layer color/width.

## Viewer basemap switcher

**Status: IMPLEMENTED.** `options.basemapChoices` (a curated `{label, kind, url}[]`,
edited via `BasemapChoicesEditor`) drives an on-map picker (`BasemapControl`,
bottom-right). When the list is non-empty it takes over from the single `basemap`
option: EFFECT B resolves the effective basemap from the viewer-selected index
(`activeBasemapIdx`, runtime-only state, default 0) and re-runs on change. Empty
list → the single `basemap`/`basemapUrl` option, unchanged. Custom-kind choices
interpolate their URL through `replaceVariables` like the single custom basemap.

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

## Area selection (box / lasso / line / trace / pick)

**Status: IMPLEMENTED.** A "Select area" tool returns a list of the features
inside/near a drawn shape, across **opt-in layers** (each layer has a `selectable`
flag; a layer must also be visible to be queried). The draw modes share one
pipeline:

- **Box** — drag a rectangle; queried with `map.queryRenderedFeatures(bbox)`.
- **Lasso** — freehand polygon; queried by its bounding box, then refined by
  testing each candidate's projected geometry against the polygon (see
  `featureInLasso` in `src/selection.ts`).
- **Line** (straight, 2-point) and **Trace** (freehand open polyline) — both feed
  `{ kind: 'line' }`; refined by `featureNearLine` (crossing via `segmentsIntersect`,
  or a point within `LINE_SELECT_BUFFER_PX` of the line).
- **Pick** — click-to-toggle: `toggleClickSelect` keeps an accumulating Map of
  `{ target, feature }` keyed by `dedupeKeyFor`, rebuilding the result via the
  shared `buildSelectionResult` on each click (so hand-picking, e.g. offline ONTs,
  produces the same grouped result as a drawn shape). EFFECT 5's `onClick` routes to
  it when the active tool is `click`.

**Ruler / measurement** (`Measure` toolbar button, mutually exclusive with select):
click points to build a path drawn as a **geo-anchored** GeoJSON line + vertices
(so it stays put on pan/zoom); `src/measure.ts` (pure, tested) does haversine
lengths and `formatDistanceBoth` (imperial + metric). A live provisional segment
follows the cursor; Esc/Clear resets; double-click-zoom is disabled while active.
**Hold** pins the current path into `heldMeasurements` (session state) drawn on a
persistent `measure-held` source.

**Session overlays (held measurements + temp markers).** Both live in runtime state
(not saved to options). Their GeoJSON sources/layers are created **lazily on top**
of the stack the first time they're used (so they're never buried), gated on a
durable `mapLoadedRef` (set on the map's initial `load`) and drawn via `setData`
directly — deliberately NOT `map.isStyleLoaded()`/`once('load')`, which flips false
during data updates and can queue a draw onto a `load` event that never fires again.
`pinOverlaysOnTop` re-raises them after any tile/marker re-apply. Temp markers
(`Annotation { id,lng,lat,name,note,color,icon }`, edited via `AnnotationEditor`)
render as one symbol layer (`icon-image`/`icon-color`/`text-field` all data-driven,
icons registered via `ensureShapeIcon`) and appear as a synthetic **Annotations**
entry in the layer control.

Key design points:

- **Lines count, not just points.** A feature is selected if any vertex is inside
  the polygon OR any of its segments crosses a polygon edge — so plant/fiber
  lines passing through the lasso are caught even with no vertex inside. Points
  must be inside; fills also count a fully-enclosed lasso.
- **Rendered-features scope.** Selection uses `queryRenderedFeatures`, so it sees
  what's drawn at the current zoom/viewport. A future option could do a
  server-side spatial query (GeoServer WFS / SQL) for completeness regardless of
  viewport — deferred.
- **Shared pipeline / seam.** `SelectionGeometry` is a union (`box` | `polygon` |
  `line`); `runSelectionQuery` gathers the raw features and `buildSelectionResult`
  produces grouped, de-duplicated results (vector tiles repeat a feature per
  covering tile — deduped by id+sourceLayer). Click-select reuses
  `buildSelectionResult` directly.
  The same `selectTooltipFields` helper that builds the click popup picks the
  columns, so the results match each layer's tooltip config.
- **Results window.** A floating, draggable, resizable window
  (`SelectionResults.tsx`) grouped by layer with counts, per-layer cap
  ("showing N of M"), highlight of selected features (existing `highlighted`
  feature-state), and export. **Copy** writes BOTH `text/html`
  (`selectionToHtmlTable` — real grids for email/rich chat) and `text/plain`
  (`selectionToPlainTable` — aligned, Markdown-style tables) via a `ClipboardItem`,
  falling back to plain text; **CSV** downloads `selectionToCsv`. All three share
  the `groupRows` column builder.
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
