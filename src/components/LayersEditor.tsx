// LayersEditor — a custom Grafana options editor for the `layers` array.
//
// Grafana's standard options builder can add single controls (text, select,
// color…) but has no built-in editor for "a list of objects". So we register
// this React component via builder.addCustomEditor() in module.ts. It receives
// the current array as `value` and reports edits back through `onChange`.
//
// React rule on display here: we never mutate `value` in place. Every change
// builds a NEW array (map/filter/spread) and passes it to onChange — that's how
// React/Grafana detect the change and re-render.

import React, { useState } from 'react';
import { StandardEditorProps, SelectableValue, GrafanaTheme2 } from '@grafana/data';
import { Button, ColorPicker, Collapse, Field, IconButton, Input, Select, Switch, useStyles2 } from '@grafana/ui';
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

// Read a number out of an <input type="number">, falling back if it's blank/NaN.
const numFrom = (e: React.FormEvent<HTMLInputElement>, fallback: number): number => {
  const n = e.currentTarget.valueAsNumber;
  return Number.isFinite(n) ? n : fallback;
};

type Props = StandardEditorProps<VectorTileLayerConfig[]>;

export const LayersEditor: React.FC<Props> = ({ value, onChange }) => {
  const styles = useStyles2(getStyles);
  const layers = value ?? [];
  // Which layer's panel is expanded. Local UI state only — not part of options.
  const [openId, setOpenId] = useState<string | null>(layers[0]?.id ?? null);

  // Immutable update of one layer by index.
  const update = (index: number, patch: Partial<VectorTileLayerConfig>) =>
    onChange(layers.map((l, i) => (i === index ? { ...l, ...patch } : l)));

  const add = () => {
    const layer = createDefaultLayer();
    onChange([...layers, layer]);
    setOpenId(layer.id);
  };
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
      {layers.map((layer, i) => (
        <Collapse
          key={layer.id}
          label={layer.name || `Layer ${i + 1}`}
          collapsible
          isOpen={openId === layer.id}
          onToggle={() => setOpenId(openId === layer.id ? null : layer.id)}
        >
          <div className={styles.toolbar}>
            <IconButton name="arrow-up" tooltip="Move up" onClick={() => move(i, -1)} />
            <IconButton name="arrow-down" tooltip="Move down" onClick={() => move(i, 1)} />
            <IconButton name="trash-alt" tooltip="Remove layer" onClick={() => remove(i)} />
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
          <Field label="Visible by default">
            <Switch value={layer.visible} onChange={(e) => update(i, { visible: e.currentTarget.checked })} />
          </Field>
        </Collapse>
      ))}

      <Button icon="plus" variant="secondary" onClick={add} className={styles.add}>
        Add layer
      </Button>
    </div>
  );
};

const getStyles = (theme: GrafanaTheme2) => ({
  toolbar: css({
    display: 'flex',
    justifyContent: 'flex-end',
    gap: theme.spacing(0.5),
    marginBottom: theme.spacing(1),
  }),
  add: css({ marginTop: theme.spacing(1) }),
});
