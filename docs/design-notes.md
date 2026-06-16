# Design notes (future work)

Running notes on features we've deliberately deferred, with the design thinking
captured so we can pick them up cleanly later. These are NOT yet implemented.

## Point marker shapes (symbol layers)

**Status:** IMPLEMENTED for marker layers (data markers). Each marker layer has a
`shape` option (circle | square | triangle | diamond | star | cross | hexagon).
`circle` renders as the native circle layer; the others render as **SDF** symbol
icons generated in `src/shapeIcons.ts` (a compact TinySDF port). SDF was chosen
over pre-colored bitmaps specifically so icons stay **data-driven recolorable**
(`icon-color` = the same per-feature `__color` circles use) and so highlight can
recolor to cyan + thicken the white halo via feature-state (paint props).
`icon-size` scales the icon so a marker's diameter matches the equivalent circle.

**Still TODO:**
- Vector-tile `circle` geometry layers don't yet honor a shape (the icon system
  is shared, so it's a small addition — gated on need).
- User-uploaded custom shapes (see below).

Original design thinking (kept for reference):

We wanted distinct shapes per layer — square, triangle, diamond, star, cross,
hexagon, etc. — to distinguish handholes / vaults / splice cases, and eventually
user-uploaded custom shapes (SVG/PNG).

**Why it's not trivial:** MapLibre has no shape primitives beyond `circle`. Other
shapes require `symbol` layers with `icon-image`, and each image must be
registered on the map via `map.addImage()`.

**Coloring choice:**
- *Pre-colored canvas icons (recommended):* render each shape on an offscreen
  canvas in the layer's configured color, `addImage` it, reference it from a
  symbol layer. Simple, crisp, no extra deps. Trade-off: not recolorable at
  runtime (color baked per layer).
- *SDF icons:* single-channel images recolorable via `icon-color` (enables
  data-driven color and recolor-on-highlight). More complex — needs a distance
  transform to generate. Only worth it if we need data-driven marker COLOR.

**Highlight:** pre-colored icons can't be recolored, so highlight a selected
point by scaling the icon up (`icon-size` via `['case', ['feature-state',...]]`)
and/or a halo, instead of the cyan recolor used for line/fill/circle.

**Plan:**
1. Add `pointShape` to the layer config (circle | square | triangle | diamond |
   star | cross | hexagon). Applies to point/circle geometry.
2. Generate the shape icon on a canvas at the layer's color + size; addImage per
   layer (keyed by shape+color+size so identical icons are shared).
3. Render via a `symbol` layer: `icon-image`, `icon-size`,
   `icon-allow-overlap: true`, `icon-ignore-placement: true` (so dense markers
   aren't dropped). Keep plain `circle` for the circle shape (crisper/faster).
4. Highlight via `icon-size` feature-state.
5. Reuse the same shape system for Phase 4 data markers.

**Future — custom upload:** let users supply an SVG/PNG (data URL in options, or
an uploaded file); addImage it and expose as a shape choice. Watch panel-options
size limits when embedding image data.

## Tooltip (feature popup) styling + content filtering

**Status:** deferred. Today the click popup is a plain HTML attribute table
(`buildPropsTable` in VectormapPanel.tsx) — readable but cramped/hard to scan.

**Wanted:**
- Better styling: wider/clearer layout, theme-aware colors, key/value alignment,
  maybe zebra striping; respect light/dark theme.
- Per-layer (or global) control over WHICH attributes show, and filtering out
  unwanted values — e.g. **hide null/empty values**, and include/exclude fields
  by name via a **regex or allow/deny list**.
- Likely a panel option like `tooltipFields` (include regex), `tooltipExclude`
  (exclude regex), and a `hideEmpty` boolean — applied in buildPropsTable.
- Consider a configurable title field (e.g. show `name`/`apb_guid` as a header).

## Configurable basemap providers

**Status:** deferred. Today the basemap is hardcoded to a single OpenStreetMap
raster source inside `VectormapPanel.tsx`.

**Goal:** let the user choose the basemap in panel options instead of it being
fixed in code. Candidate sources:

- Raster XYZ providers (OSM, Carto Positron/Dark Matter, custom `{z}/{x}/{y}`
  endpoints).
- Vector style URLs (MapTiler, OpenMapTiles, a self-hosted style.json) — these
  give crisp, restyleable vector basemaps.
- A "blank / none" option (no basemap; just our overlay layers on a background
  color).
- A fully custom MapLibre style JSON URL for advanced users.

**Proposed option shape:** a `basemap` select with presets, plus a free-text
`basemapUrl` shown only when a "Custom raster XYZ" or "Custom style URL" preset
is chosen (use the options builder's `showIf`). Allow Grafana variable
interpolation in the URL (consistent with how tile layers will work).

**Design considerations / gotchas to handle when we build it:**

1. **Raster vs. vector styles are constructed differently.** A vector style is
   passed to MapLibre as a style URL/object directly. A raster source must be
   wrapped in a minimal style (as we do now). The code needs a branch that
   builds the right `style` for the chosen provider.

2. **Switching basemap at runtime uses `map.setStyle()`, which REPLACES the
   entire style** — including any vector-tile overlay layers we've added (Phase
   3+). We must re-add our overlay sources/layers after the new style finishes
   loading (`map.once('styledata', ...)` or the `style.load` event). This is the
   single most important interaction to get right; plan the layer-management
   code so overlays can be (re)applied idempotently on top of whatever basemap
   is active.

3. **API keys.** Providers like MapTiler require a key in the URL. Panel options
   are stored in the dashboard JSON in plaintext — NOT secret. Recommend users
   put the key in a Grafana template variable and interpolate it, rather than
   pasting it raw, and document that the key is not hidden.

4. **Attribution & terms of service.** Each provider has its own attribution
   text and usage limits. Carry the correct `attribution` per source, and keep
   the OSM-usage-policy warning relevant (don't hammer free tiles in prod).

5. **Layer ordering.** Vector basemaps already define many layers; our overlay
   layers must be inserted above them (and below labels if we want labels on
   top). The add-layer call may need a `beforeId`.
