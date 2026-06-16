// LayersEditor — custom Grafana options editor for the `layers` array.
//
// Grafana's standard options builder cannot edit "a list of objects", so we
// register this component via builder.addCustomEditor() in module.ts. It gets
// the current array as `value` and reports edits through `onChange`. We never
// mutate `value` in place — every change builds a NEW array.

import React from 'react';
import { StandardEditorProps, SelectableValue, GrafanaTheme2 } from '@grafana/data';
import { Button, ColorPicker, Field, Input, Select, Switch, useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';
import { VectorTileLayerConfig, GeometryType, TileScheme, createDefaultLayer } from '../types';

const SCHEME_OPTIONS: Array<SelectableValue<TileScheme>> = [
  { label: 'XYZ', value: 'xyz' },
  { label: 'TMS', value: 'tms' },
];
const GEOMETRY_OPTIONS: Array<SelectableValue<GeometryType>> = [
  { label: 'Line', value: 'line' },
  { label: 'Fill', value: 'fill' },
  { label: 'Circle', value: 'circle' },
];

// Read a number out of a numeric <input>, falling back if blank/NaN.
const numFrom = (e: React.FormEvent<HTMLInputElement>, fallback: number): number => {
  const n = e.currentTarget.valueAsNumber;
  return Number.isFinite(n) ? n : fallback;
};

type Props = StandardEditorProps<VectorTileLayerConfig[]>;

export const LayersEditor: React.FC<Props> = ({ value, onChange }) => {
  const styles = useStyles2(getStyles);
  const layers = value ?? [];

  const update = (index: number, patch: Partial<VectorTileLayerConfig>) =>
    onChange(layers.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  const add = () => onChange([...layers, createDefaultLayer()]);
  const remove = (index: number) => onChange(layers.filter((_, i) => i !== index));
  const move = (index: number, dir: -1 | 1) => {
    const j = index + dir;
    if (j < 0 || j >= layers.length) {
      return;
    }
    const next = [...layers];
    [next[index], next[j]] = [next[j], next[index]];
    onChange(next);
  };

  return (
    <div>
      <Button icon="plus" variant="primary" size="sm" onClick={add} className={styles.addTop}>
        Add layer
      </Button>

      {layers.length === 0 && <div className={styles.empty}>No layers yet — click “Add layer”.</div>}

      {layers.map((layer, i) => (
        <div key={layer.id} className={styles.card}>
          <div className={styles.header}>
            <strong>{layer.name || `Layer ${i + 1}`}</strong>
            <div className={styles.headerBtns}>
              <Button size="sm" variant="secondary" fill="text" onClick={() => move(i, -1)} title="Move up">
                ↑
              </Button>
              <Button size="sm" variant="secondary" fill="text" onClick={() => move(i, 1)} title="Move down">
                ↓
              </Button>
              <Button size="sm" variant="destructive" fill="text" onClick={() => remove(i)}>
                Remove
              </Button>
            </div>
          </div>

          <Field label="Name">
            <Input value={layer.name} onChange={(e) => update(i, { name: e.currentTarget.value })} />
          </Field>
          <Field label="Group" description="Optional heading in the layer control ('' = ungrouped)">
            <Input value={layer.group} onChange={(e) => update(i, { group: e.currentTarget.value })} />
          </Field>
          <Field label="Tile URL" description="MVT/PBF template containing {z}/{x}/{y}">
            <Input value={layer.tileUrl} onChange={(e) => update(i, { tileUrl: e.currentTarget.value })} />
          </Field>
          <Field label="Source layer" description="Layer name INSIDE the tile (not the GeoServer id)">
            <Input value={layer.sourceLayer} onChange={(e) => update(i, { sourceLayer: e.currentTarget.value })} />
          </Field>
          <Field label="Tile scheme" description="TMS for GeoServer GWC endpoints">
            <Select
              options={SCHEME_OPTIONS}
              value={layer.tileScheme}
              onChange={(v) => update(i, { tileScheme: v.value ?? 'xyz' })}
            />
          </Field>
          <Field label="Geometry type">
            <Select
              options={GEOMETRY_OPTIONS}
              value={layer.geometryType}
              onChange={(v) => update(i, { geometryType: v.value ?? 'line' })}
            />
          </Field>

          {layer.geometryType === 'line' && (
            <>
              <Field label="Line color">
                <ColorPicker color={layer.lineColor} onChange={(c) => update(i, { lineColor: c })} />
              </Field>
              <Field label="Line width">
                <Input
                  type="number"
                  min={0}
                  step={0.5}
                  value={layer.lineWidth}
                  onChange={(e) => update(i, { lineWidth: numFrom(e, 2) })}
                />
              </Field>
            </>
          )}
          {layer.geometryType === 'fill' && (
            <>
              <Field label="Fill color">
                <ColorPicker color={layer.fillColor} onChange={(c) => update(i, { fillColor: c })} />
              </Field>
              <Field label="Fill opacity">
                <Input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={layer.fillOpacity}
                  onChange={(e) => update(i, { fillOpacity: numFrom(e, 0.4) })}
                />
              </Field>
            </>
          )}
          {layer.geometryType === 'circle' && (
            <>
              <Field label="Circle color">
                <ColorPicker color={layer.circleColor} onChange={(c) => update(i, { circleColor: c })} />
              </Field>
              <Field label="Circle radius">
                <Input
                  type="number"
                  min={0}
                  value={layer.circleRadius}
                  onChange={(e) => update(i, { circleRadius: numFrom(e, 5) })}
                />
              </Field>
            </>
          )}

          <Field label="Filter (advanced)" description='MapLibre filter as JSON, e.g. ["==","status","active"]'>
            <Input
              value={layer.filterExpression}
              onChange={(e) => update(i, { filterExpression: e.currentTarget.value })}
            />
          </Field>

          {/* Per-layer tooltip content controls */}
          <Field label="Tooltip: hide empty values">
            <Switch
              value={layer.tooltipHideEmpty}
              onChange={(e) => update(i, { tooltipHideEmpty: e.currentTarget.checked })}
            />
          </Field>
          <Field label="Tooltip: title field" description="Field shown as a bold header (optional)">
            <Input
              value={layer.tooltipTitleField}
              onChange={(e) => update(i, { tooltipTitleField: e.currentTarget.value })}
            />
          </Field>
          <Field label="Tooltip: include fields (regex)" description="Show only matching field names. Blank = all.">
            <Input
              value={layer.tooltipInclude}
              onChange={(e) => update(i, { tooltipInclude: e.currentTarget.value })}
            />
          </Field>
          <Field label="Tooltip: exclude fields (regex)" description="Hide matching field names, e.g. user|created|geom">
            <Input
              value={layer.tooltipExclude}
              onChange={(e) => update(i, { tooltipExclude: e.currentTarget.value })}
            />
          </Field>

          <Field label="Visible by default">
            <Switch value={layer.visible} onChange={(e) => update(i, { visible: e.currentTarget.checked })} />
          </Field>
        </div>
      ))}
    </div>
  );
};

const getStyles = (theme: GrafanaTheme2) => ({
  addTop: css({ marginBottom: theme.spacing(1) }),
  empty: css({ color: theme.colors.text.secondary, marginBottom: theme.spacing(1) }),
  card: css({
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: 2,
    padding: theme.spacing(1),
    marginBottom: theme.spacing(1),
  }),
  header: css({
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing(1),
  }),
  headerBtns: css({ display: 'flex', gap: theme.spacing(0.5) }),
});
