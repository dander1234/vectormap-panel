# Changelog

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
