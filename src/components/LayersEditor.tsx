// LayersEditor — custom Grafana options editor for the `layers` array.
//
// Grafana's standard options builder cannot edit "a list of objects", so we
// register this component via builder.addCustomEditor() in module.ts. It gets
// the current array as `value` and reports edits through `onChange`. We never
// mutate `value` in place — every change builds a NEW array.

import React, { useState } from 'react';
import { StandardEditorProps, SelectableValue, GrafanaTheme2 } from '@grafana/data';
import { Button, ColorPicker, Field, Icon, Input, Select, Switch, useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';
import { VectorTileLayerConfig, GeometryType, TileScheme, createDefaultLayer } from '../types';
import { TooltipLinksEditor } from './TooltipLinksEditor';

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

  // Which cards are expanded (by layer id). Cards start COLLAPSED so a long list
  // stays compact; a newly added layer auto-expands so you can fill it in.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggle = (id: string) => setExpanded((p) => ({ ...p, [id]: !p[id] }));

  const update = (index: number, patch: Partial<VectorTileLayerConfig>) =>
    onChange(layers.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  const add = () => {
    const layer = createDefaultLayer();
    setExpanded((p) => ({ ...p, [layer.id]: true }));
    onChange([...layers, layer]);
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
      <Button icon="plus" variant="primary" size="sm" onClick={add} className={styles.addTop}>
        Add layer
      </Button>

      {layers.length === 0 && <div className={styles.empty}>No layers yet — click “Add layer”.</div>}

      {layers.map((layer, i) => {
        const isOpen = expanded[layer.id] ?? false;
        // One-line summary shown when collapsed: geometry + source layer.
        const summary = `${layer.geometryType}${layer.sourceLayer ? ` · ${layer.sourceLayer}` : ' · (no source)'}`;
        return (
        <div key={layer.id} className={styles.card}>
          <div className={styles.header}>
            <button type="button" className={styles.titleBtn} onClick={() => toggle(layer.id)}>
              <Icon name={isOpen ? 'angle-down' : 'angle-right'} />
              <strong>{layer.name || `Layer ${i + 1}`}</strong>
              {!isOpen && <span className={styles.summary}>{summary}</span>}
            </button>
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

          {isOpen && (
          <>
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
          <Field
            label="ID field"
            description="Optional: a unique feature property to use as the id (e.g. gid/fid). Enables click & selection highlighting on tiles with no built-in id (GeoServer)."
          >
            <Input
              value={layer.idField ?? ''}
              placeholder="(leave blank if tiles already carry ids)"
              onChange={(e) => update(i, { idField: e.currentTarget.value })}
            />
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
          <Field label="Tooltip: links">
            <TooltipLinksEditor value={layer.tooltipLinks ?? []} onChange={(links) => update(i, { tooltipLinks: links })} />
          </Field>

          <Field label="Visible by default">
            <Switch value={layer.visible} onChange={(e) => update(i, { visible: e.currentTarget.checked })} />
          </Field>

          <Field
            label="Selectable"
            description="Include this layer in the 'Select area' tool (only counts when the layer is also visible)"
          >
            <Switch
              value={layer.selectable !== false}
              onChange={(e) => update(i, { selectable: e.currentTarget.checked })}
            />
          </Field>
          </>
          )}
        </div>
        );
      })}
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
    gap: theme.spacing(1),
  }),
  // The clickable title acts as the collapse toggle; reset native button styling.
  titleBtn: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    background: 'none',
    border: 'none',
    padding: 0,
    cursor: 'pointer',
    color: theme.colors.text.primary,
    textAlign: 'left',
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
  }),
  summary: css({
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  }),
  headerBtns: css({ display: 'flex', gap: theme.spacing(0.5), flexShrink: 0 }),
});
