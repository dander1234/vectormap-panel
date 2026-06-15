# Design notes (future work)

Running notes on features we've deliberately deferred, with the design thinking
captured so we can pick them up cleanly later. These are NOT yet implemented.

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
