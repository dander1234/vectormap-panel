# Changelog

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
