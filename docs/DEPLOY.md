# Deploying the Vectormap panel

This guide explains how to install the **Vectormap** panel into a Grafana
instance and get a map on screen. There are two install paths:

- **A. Prebuilt zip** — fastest; no Node.js/build step. Use this to drop the
  plugin into another Grafana.
- **B. Build from source** — for development or building your own copy.

Plugin id: **`dander1234-vectormap-panel`** (the install folder must be named
exactly this).

---

## Prerequisites

- **Grafana ≥ 12.1** (developed and tested against Grafana 13).
- For **vector tile layers**: a tile server that serves MVT/PBF tiles over an
  XYZ or TMS URL (e.g. GeoServer GWC, Martin, Tegola, pg_tileserv). Optional —
  you can use the panel with only data markers.
- For **markers**: any Grafana datasource whose query returns latitude and
  longitude columns (PostgreSQL, MySQL, InfluxDB, …).

This plugin is **unsigned**, so Grafana must be told to allow it (see step 3).

---

## A. Install the prebuilt zip

1. **Download** `dander1234-vectormap-panel-<version>.zip` from the repo's
   [Releases](https://github.com/dander1234/vectormap-panel/releases).

2. **Unzip into Grafana's plugins directory.** The zip already contains a
   top-level `dander1234-vectormap-panel/` folder, so unzip it directly:

   ```bash
   # Default plugins dir for a package install is /var/lib/grafana/plugins
   sudo unzip dander1234-vectormap-panel-1.0.0.zip -d /var/lib/grafana/plugins/
   sudo chown -R grafana:grafana /var/lib/grafana/plugins/dander1234-vectormap-panel
   ```

   You should end up with
   `/var/lib/grafana/plugins/dander1234-vectormap-panel/plugin.json`.

   > Not sure where your plugins dir is? It's the `plugins` path under Grafana's
   > data directory — check `paths.plugins` in `grafana.ini`. Common values:
   > `/var/lib/grafana/plugins` (deb/rpm) or `<grafana>/data/plugins` (binary/zip).

3. **Allow the unsigned plugin.** Add it to `grafana.ini` (usually
   `/etc/grafana/grafana.ini`):

   ```ini
   [plugins]
   allow_loading_unsigned_plugins = dander1234-vectormap-panel
   ```

   Or, equivalently, set an environment variable on the Grafana process:

   ```bash
   GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=dander1234-vectormap-panel
   ```

   Docker example:

   ```bash
   docker run -d -p 3000:3000 \
     -e GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=dander1234-vectormap-panel \
     -v "$PWD/dander1234-vectormap-panel:/var/lib/grafana/plugins/dander1234-vectormap-panel" \
     grafana/grafana:latest
   ```

4. **Restart Grafana** and verify (see [Verifying](#verifying-the-install)).

   ```bash
   sudo systemctl restart grafana-server
   ```

---

## B. Build from source

Requires **Node.js ≥ 22**.

```bash
git clone https://github.com/dander1234/vectormap-panel.git
cd vectormap-panel
npm install
npm run build          # outputs the loadable plugin into ./dist
```

Then make `dist/` available to Grafana under the plugin id — either copy it or
symlink it:

```bash
# Copy
sudo cp -r dist /var/lib/grafana/plugins/dander1234-vectormap-panel

# …or symlink (handy during development with `npm run dev`)
sudo ln -s "$PWD/dist" /var/lib/grafana/plugins/dander1234-vectormap-panel
```

Allow the unsigned plugin (step A.3 above) and restart Grafana.

During development, `npm run dev` rebuilds on save — just refresh the browser.
Changes to `plugin.json` require a Grafana restart.

---

## Verifying the install

1. In Grafana, go to **Administration → Plugins** and search for "Vectormap".
   It should appear (marked as an unsigned plugin).
2. If it's missing, check the Grafana server log for lines mentioning the plugin
   id — the most common cause is the unsigned-plugins setting not being applied,
   or the folder not being named exactly `dander1234-vectormap-panel`.
3. Create a new panel and choose **Vectormap** as the visualization.

---

## Configuring a panel (quick start)

- **Map view** — set initial latitude/longitude/zoom, or pan/zoom the map and
  click **Set initial view** to capture the current position.
- **Basemap** — choose OpenStreetMap, CARTO, satellite, blank, or a custom XYZ
  raster URL.
- **Vector tile layers** — add a layer, paste its tile URL (containing
  `{z}/{x}/{y}`), set the source layer name, geometry type, and paint. For
  GeoServer GWC endpoints set **Tile scheme = TMS**.
- **Marker layers (from data)** — add a marker layer, bind it to a query
  (`refId`), pick lat/long fields (or let it auto-detect), color/size by a field,
  and choose a shape. Configure per-layer tooltip fields and links.

See the [README](../README.md#features) for the full feature list.

### Try it without a backend

You can exercise every feature with no external services:

- **Markers** — add a query on the built-in **TestData** datasource, scenario
  **CSV Content**, and paste:

  ```
  lat,lng,name,status
  37.7749,-122.4194,San Francisco,up
  34.0522,-118.2437,Los Angeles,down
  40.7128,-74.0060,New York,up
  ```

  Add a marker layer with Lat/Lng = `lat`/`lng`, pick a shape, and set a color
  mode (e.g. a regex rule on `status`). Click a marker for its tooltip.

- **Vector tiles** — add a vector tile layer pointing at MapLibre's public demo
  tiles (no GeoServer required):

  | Option | Value |
  | --- | --- |
  | Tile URL | `https://demotiles.maplibre.org/tiles/{z}/{x}/{y}.pbf` |
  | Source layer | `countries` |
  | Geometry type | `fill` |
  | Tile scheme | `XYZ` |

  Zoom out (this endpoint serves zoom 0–6) — country polygons render from the
  vector tiles.

### Serving vector tiles to the browser

The browser fetches tiles directly from the tile URL you configure, so that URL
must be reachable from the user's browser and must send permissive **CORS**
headers (`Access-Control-Allow-Origin`). If your tile server is internal, put it
behind the same reverse proxy as Grafana (e.g. proxy `/tiles` → tile server) and
add the CORS header there. Tile URLs support Grafana template variables, so you
can parameterize them (e.g. `…/{z}/{x}/{y}.pbf?region=${region}`).

---

## Upgrading

Replace the plugin folder with the new version (or rebuild `dist/`) and restart
Grafana:

```bash
sudo rm -rf /var/lib/grafana/plugins/dander1234-vectormap-panel
sudo unzip dander1234-vectormap-panel-<new-version>.zip -d /var/lib/grafana/plugins/
sudo systemctl restart grafana-server
```

## Uninstalling

Remove the plugin folder and restart Grafana:

```bash
sudo rm -rf /var/lib/grafana/plugins/dander1234-vectormap-panel
sudo systemctl restart grafana-server
```
