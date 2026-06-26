# Changelog

## 1.7.0

- Fix: clicking a **vector tile feature now shows its tooltip even when the tile
  carries no per-feature id**. GeoServer (and many other MVT sources) omit the
  optional feature id, which previously caused the click to be discarded — the
  same tiles showed attributes fine in OpenLayers. The popup now renders from the
  feature's properties regardless; the click-highlight ring is still applied when
  an id is present. (The **Select area** tool already handled idless tiles.)
- Feature: the search box's placeholder text is now configurable. *Address search
  → Search box placeholder* lets you word the empty box for your data (e.g. "Find
  an ONT or account"); leave it blank for the default ("Search address or ID…").

## 1.6.0

- Feature: the **Select area** results table now honors each layer's configured
  tooltip links. A link whose URL references a single field (e.g.
  `…/equip/${equipment_id}`) turns that column's values into clickable links;
  links referencing multiple/zero fields appear in a trailing **Links** column as
  labeled links. Respects `openInNewTab` and dashboard-variable interpolation.

## 1.5.0

- Feature: the search box can now look up **account ID** and **equipment ID** in
  addition to address. Each marker layer gains **Account ID field** and
  **Equipment ID field** mappings (numeric); a query is matched against whichever
  of address/account/equipment a layer has set, and the dropdown tags each hit by
  which field matched. Picking a result flies to and pins the existing point, as
  with address search.

## 1.4.0

- Feature: **address search box**. Jump the map to an address — matching local
  query data first (set a marker layer's **Address field**, e.g. an ONT's street
  address) and falling back to an external **geocoder** on demand. Picking a
  result flies there, drops a pin, and opens a popup (local hits show the
  feature's attributes). Geocoder is configurable: **Nominatim** (OpenStreetMap,
  default), a **custom endpoint** (URL template, GeoJSON or Nominatim-style), or
  **None** (local-only).

## 1.3.0

- Feature: **Select area** tool. Draw a **box** or a freehand **lasso** on the
  map to list every feature inside it, across the layers you opt in. Lines (plant
  segments) are included when they cross the lasso, not just when a vertex is
  inside. Results appear in a **movable, resizable window** grouped by layer, with
  per-layer counts and **Copy / CSV** export; selected features are highlighted.
- Each tile and marker layer gains a **Selectable** toggle (default on) so a layer
  can be included in or excluded from selections independently of visibility.

## 1.2.2

- Build: enable build provenance attestation in the release workflow
  (`attestation: true` on the build action) so the published zip carries a
  verifiable sigstore attestation tying it to this source.

## 1.2.1

- Fix: remove the direct `maplibre-gl` stylesheet import (disallowed by Grafana
  plugin code rules). The MapLibre CSS is now injected via emotion, scoped to the
  map container, so there is no global CSS and no direct stylesheet import.

## 1.2.0

- Fix: legend icons in the on-map layer control now match the shape drawn on the
  map (e.g. a triangle marker layer shows a triangle, not a square); vector tile
  layers show a line/square/dot for line/fill/circle geometry.
- Docs: added product and configuration screenshots.

## 1.1.0

- Marker color modes: in addition to fixed and by-field (Grafana standard
  config), marker layers can now color points by explicit **thresholds** or
  **regex** rules defined directly on the layer.

## 1.0.0

Initial release.

- Vector tile (MVT/PBF) layers: tile URL, source layer, geometry/paint, optional
  MapLibre filter, TMS/XYZ scheme.
- Marker layers from panel query data (SQL, InfluxDB, any datasource), bound per
  query (`refId`), colored/sized by Grafana standard field configs.
- Marker shapes: circle, square, triangle, diamond, star, cross, hexagon
  (recolorable SDF icons).
- Unified, grouped on-map layer control for tile and marker layers.
- Per-layer tooltips: field include/exclude regex, hide-empty, title field, and
  templated links (`${field}` + Grafana dashboard variables).
- Basemaps: OpenStreetMap, CARTO light/dark, Esri satellite, blank, or custom XYZ.
- "Set initial view" button.
- Grafana template-variable interpolation in tile/basemap URLs and filters.
