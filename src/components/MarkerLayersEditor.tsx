// MarkerLayersEditor — custom Grafana options editor for the `markerLayers`
// array (markers built from query data: SQL, InfluxDB, …).
//
// Registered via builder.addCustomEditor() in module.ts (Grafana's standard
// builder can't edit a list of objects). It receives the current array as
// `value`, reports edits through `onChange`, and — unlike the tile-layer editor
// — also reads `context.data` (the panel's live query results) so the field
// pickers can offer the actual column names returned by each query.
//
// We never mutate `value` in place: every change builds a NEW array.

import React, { useState } from 'react';
import { StandardEditorProps, SelectableValue, GrafanaTheme2, DataFrame } from '@grafana/data';
import { Button, ColorPicker, Field, Icon, Input, Select, Switch, useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';
import { MarkerLayerConfig, createDefaultMarkerLayer } from '../types';
import { TooltipLinksEditor } from './TooltipLinksEditor';

// Read a number out of a numeric <input>, falling back if blank/NaN.
const numFrom = (e: React.FormEvent<HTMLInputElement>, fallback: number): number => {
  const n = e.currentTarget.valueAsNumber;
  return Number.isFinite(n) ? n : fallback;
};

// Distinct refIds present in the query results (the A/B/C letters), in order.
const refIdsFrom = (frames: DataFrame[]): string[] => {
  const seen: string[] = [];
  for (const f of frames) {
    if (f.refId && !seen.includes(f.refId)) {
      seen.push(f.refId);
    }
  }
  return seen;
};

// Distinct field (column) names available for a marker layer. If the layer is
// bound to a refId we only list that query's fields; otherwise we list all.
const fieldNamesFor = (frames: DataFrame[], refId: string): string[] => {
  const picked = refId ? frames.filter((f) => f.refId === refId) : frames;
  const names: string[] = [];
  for (const f of picked) {
    for (const fld of f.fields) {
      if (!names.includes(fld.name)) {
        names.push(fld.name);
      }
    }
  }
  return names;
};

// A field picker backed by the live column names, but with allowCustomValue so
// it still works when no data has loaded yet (you can just type the name). An
// empty value means "auto-detect / none", shown via the placeholder.
const FieldSelect: React.FC<{
  value: string;
  names: string[];
  placeholder: string;
  onChange: (name: string) => void;
}> = ({ value, names, placeholder, onChange }) => {
  const options: Array<SelectableValue<string>> = names.map((n) => ({ label: n, value: n }));
  return (
    <Select
      options={options}
      value={value || null}
      placeholder={placeholder}
      isClearable
      allowCustomValue
      onCreateOption={(v) => onChange(v)}
      onChange={(v) => onChange(v?.value ?? '')}
    />
  );
};

type Props = StandardEditorProps<MarkerLayerConfig[]>;

export const MarkerLayersEditor: React.FC<Props> = ({ value, onChange, context }) => {
  const styles = useStyles2(getStyles);
  const layers = value ?? [];
  const frames = context?.data ?? [];
  const refIds = refIdsFrom(frames);
  const refIdOptions: Array<SelectableValue<string>> = refIds.map((r) => ({ label: r, value: r }));

  // Which cards are expanded (by layer id). Collapsed by default; a newly added
  // layer auto-expands.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggle = (id: string) => setExpanded((p) => ({ ...p, [id]: !p[id] }));

  const update = (index: number, patch: Partial<MarkerLayerConfig>) =>
    onChange(layers.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  const add = () => {
    const layer = createDefaultMarkerLayer();
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
        Add marker layer
      </Button>

      {layers.length === 0 && (
        <div className={styles.empty}>
          No marker layers yet. Add a query (Query tab) that returns latitude/longitude columns, then click “Add marker
          layer”.
        </div>
      )}

      {layers.map((layer, i) => {
        // Column names offered to this layer's field pickers (scoped to its query).
        const names = fieldNamesFor(frames, layer.refId);
        const isOpen = expanded[layer.id] ?? false;
        // One-line summary when collapsed: which query it reads + color-by field.
        // A blank refId means "all queries" — surfaced here so the merge-everything
        // footgun is obvious without expanding the card.
        const summary = `${layer.refId ? `query ${layer.refId}` : 'ALL queries'}${
          layer.colorField ? ` · color: ${layer.colorField}` : ''
        }`;
        return (
          <div key={layer.id} className={styles.card}>
            <div className={styles.header}>
              <button type="button" className={styles.titleBtn} onClick={() => toggle(layer.id)}>
                <Icon name={isOpen ? 'angle-down' : 'angle-right'} />
                <strong>{layer.name || `Marker layer ${i + 1}`}</strong>
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
            <Field label="Query (refId)" description="Which query to read points from. Blank = all queries.">
              <Select
                options={refIdOptions}
                value={layer.refId || null}
                placeholder="All queries"
                isClearable
                allowCustomValue
                onCreateOption={(v) => update(i, { refId: v })}
                onChange={(v) => update(i, { refId: v?.value ?? '' })}
              />
            </Field>

            <Field label="Latitude field" description="Blank = auto-detect (lat / latitude / y)">
              <FieldSelect
                value={layer.latField}
                names={names}
                placeholder="Auto-detect"
                onChange={(n) => update(i, { latField: n })}
              />
            </Field>
            <Field label="Longitude field" description="Blank = auto-detect (lng / long / longitude / lon / x)">
              <FieldSelect
                value={layer.lngField}
                names={names}
                placeholder="Auto-detect"
                onChange={(n) => update(i, { lngField: n })}
              />
            </Field>

            <Field
              label="Color by field"
              description="Marker color from this field's standard config (value mappings / thresholds). Blank = fixed."
            >
              <FieldSelect
                value={layer.colorField}
                names={names}
                placeholder="Fixed color"
                onChange={(n) => update(i, { colorField: n })}
              />
            </Field>
            <Field label="Fixed color" description="Used when no color field is chosen">
              <ColorPicker color={layer.fixedColor} onChange={(c) => update(i, { fixedColor: c })} />
            </Field>

            <Field label="Size by field" description="Numeric field to scale marker radius. Blank = fixed size.">
              <FieldSelect
                value={layer.sizeField}
                names={names}
                placeholder="Fixed size"
                onChange={(n) => update(i, { sizeField: n })}
              />
            </Field>
            <Field label="Marker size" description="Radius in px (base; the minimum when scaling by a field)">
              <Input
                type="number"
                min={1}
                step={1}
                value={layer.size}
                onChange={(e) => update(i, { size: numFrom(e, 6) })}
              />
            </Field>
            <Field label="Max marker size" description="Maximum radius (px) when scaling by a field">
              <Input
                type="number"
                min={1}
                step={1}
                value={layer.sizeMax}
                onChange={(e) => update(i, { sizeMax: numFrom(e, 18) })}
              />
            </Field>

            {/* Per-layer tooltip content controls (same model as tile layers). */}
            <Field label="Tooltip: hide empty values">
              <Switch
                value={layer.tooltipHideEmpty}
                onChange={(e) => update(i, { tooltipHideEmpty: e.currentTarget.checked })}
              />
            </Field>
            <Field label="Tooltip: title field" description="Field shown as a bold header (optional)">
              <FieldSelect
                value={layer.tooltipTitleField}
                names={names}
                placeholder="None"
                onChange={(n) => update(i, { tooltipTitleField: n })}
              />
            </Field>
            <Field label="Tooltip: include fields (regex)" description="Show only matching field names. Blank = all.">
              <Input
                value={layer.tooltipInclude}
                onChange={(e) => update(i, { tooltipInclude: e.currentTarget.value })}
              />
            </Field>
            <Field label="Tooltip: exclude fields (regex)" description="Hide matching field names, e.g. geom|internal">
              <Input
                value={layer.tooltipExclude}
                onChange={(e) => update(i, { tooltipExclude: e.currentTarget.value })}
              />
            </Field>
            <Field label="Tooltip: links">
              <TooltipLinksEditor
                value={layer.tooltipLinks ?? []}
                onChange={(links) => update(i, { tooltipLinks: links })}
              />
            </Field>

            <Field label="Visible by default">
              <Switch value={layer.visible} onChange={(e) => update(i, { visible: e.currentTarget.checked })} />
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
