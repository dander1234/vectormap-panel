# Vectormap panel for Grafana

A [MapLibre GL JS](https://maplibre.org/) panel plugin for Grafana that renders
vector tile layers (MVT/PBF) and data-driven markers on an interactive map.

Plugin ID: `dander1234-vectormap-panel`

## Why

Grafana's built-in Geomap panel loads geospatial overlays as static GeoJSON,
re-fetching and re-parsing every vertex in the browser on each refresh — which
does not scale to large datasets (fiber routes, plant infrastructure, millions
of vertices). Vectormap instead streams **vector tiles** from a tile server
(GeoServer, Martin, Tegola, or any TMS/XYZ endpoint), so the browser only ever
loads the tiles in view at the current zoom.

## Features

- Multiple configurable vector tile layers (tile URL, source layer, paint
  properties, optional filter) — all set through panel options.
- Markers plotted from panel query results (lat/long fields), styled with
  Grafana standard field configs.
- Tooltips and data links for both markers and vector tile features.
- Grafana template-variable interpolation in tile URLs and queries.

## Development

Requires Node.js >= 22.

```bash
npm install        # install dependencies
npm run dev        # build in watch mode (rebuilds on save)
npm run build      # production build
npm run typecheck  # TypeScript type checking
npm run lint       # lint
```

The build output lands in `dist/`. To load it in a local Grafana, symlink (or
copy) `dist/` into Grafana's plugins directory under the plugin ID, and allow
the unsigned plugin in `grafana.ini`:

```ini
[plugins]
allow_loading_unsigned_plugins = dander1234-vectormap-panel
```

Then restart Grafana. Changes to frontend code only require a `npm run dev`
rebuild and a browser refresh; changes to `plugin.json` require a Grafana
restart.

## Publishing

To publish to the Grafana catalog the plugin must be signed. The first segment
of the plugin ID (`dander1234`) must match your Grafana Cloud account slug. See
the Grafana [plugin publishing and signing](https://grafana.com/legal/plugins/#plugin-publishing-and-signing-criteria)
docs. The scaffolded GitHub Actions release workflow can sign and package on a
version tag (`npm version <major|minor|patch>` then push with `--follow-tags`),
given a `GRAFANA_API_KEY` repository secret.

## License

Apache-2.0
