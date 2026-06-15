# Vectormap

A [MapLibre GL JS](https://maplibre.org/) panel for Grafana.

It renders an interactive vector map with two kinds of layers:

- **Vector tile layers (MVT/PBF)** served from GeoServer, Martin, Tegola, or any
  TMS/XYZ tile endpoint — configured entirely through panel options, with full
  support for Grafana template-variable interpolation in tile URLs.
- **Data markers** plotted from your panel's query results (latitude / longitude
  fields), styled with Grafana's standard field configuration.

It exists to render large geospatial datasets that the built-in Geomap panel
struggles with, by streaming vector tiles instead of loading static GeoJSON on
every refresh.

## Requirements

- Grafana >= 12.1.0

## Getting started

Add the panel to a dashboard, then configure your tile layers and marker fields
in the panel options. See the project repository for full documentation.

## Status

Under active development. See the repository for the current roadmap.
