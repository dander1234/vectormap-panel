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

## Area / polygon selection (planned)

**Status: NOT yet implemented.** A planned tool to draw a polygon (or
click-drag box) on the map and return a list of the features inside it across
**opt-in layers** — e.g. "which customers / ONTs / plant segments fall in this
area" — rendered into a larger popup or a results panel. Per-layer opt-in so the
selection can target specific layers. Design to be captured here when we start.
