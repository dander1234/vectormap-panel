// BasemapChoicesEditor — options editor for the viewer-facing basemap switcher.
//
// The admin curates a list of BasemapChoice ({ label, kind, url }). When the list
// is non-empty the panel shows an on-map picker so viewers can switch basemaps at
// runtime. Like the other list editors here, it never mutates the array in place.

import React from 'react';
import { StandardEditorProps, SelectableValue, GrafanaTheme2 } from '@grafana/data';
import { Button, Field, Input, Select, useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';
import { BasemapChoice, BasemapKind } from '../types';

// Same set the single Basemap option offers.
const KIND_OPTIONS: Array<SelectableValue<BasemapKind>> = [
  { value: 'osm', label: 'OpenStreetMap' },
  { value: 'carto-light', label: 'CARTO light' },
  { value: 'carto-dark', label: 'CARTO dark' },
  { value: 'satellite', label: 'Satellite (Esri)' },
  { value: 'none', label: 'None (blank)' },
  { value: 'custom', label: 'Custom XYZ URL' },
];

type Props = StandardEditorProps<BasemapChoice[]>;

export const BasemapChoicesEditor: React.FC<Props> = ({ value, onChange }) => {
  const styles = useStyles2(getStyles);
  const choices = value ?? [];

  const update = (index: number, patch: Partial<BasemapChoice>) =>
    onChange(choices.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  const add = () => onChange([...choices, { label: 'New basemap', kind: 'osm', url: '' }]);
  const remove = (index: number) => onChange(choices.filter((_, i) => i !== index));

  return (
    <div>
      <div className={styles.hint}>
        Curate the basemaps a viewer can switch between on the map. Leave empty to
        use the single <b>Basemap</b> option above with no picker. The first entry
        is the default.
      </div>
      {choices.map((choice, i) => (
        <div key={i} className={styles.row}>
          <Field label="Label" className={styles.grow}>
            <Input value={choice.label} onChange={(e) => update(i, { label: e.currentTarget.value })} />
          </Field>
          <Field label="Basemap" className={styles.grow}>
            <Select
              options={KIND_OPTIONS}
              value={choice.kind}
              onChange={(v) => update(i, { kind: v.value ?? 'osm' })}
            />
          </Field>
          {choice.kind === 'custom' && (
            <Field label="Custom XYZ URL" className={styles.growWide} description="{z}/{x}/{y} raster template">
              <Input
                value={choice.url}
                placeholder="https://…/{z}/{x}/{y}.png"
                onChange={(e) => update(i, { url: e.currentTarget.value })}
              />
            </Field>
          )}
          <Button size="sm" variant="destructive" fill="text" onClick={() => remove(i)} title="Remove basemap">
            ✕
          </Button>
        </div>
      ))}
      <Button icon="plus" size="sm" variant="secondary" onClick={add}>
        Add basemap
      </Button>
    </div>
  );
};

const getStyles = (theme: GrafanaTheme2) => ({
  hint: css({
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    marginBottom: theme.spacing(0.5),
  }),
  row: css({
    display: 'flex',
    gap: theme.spacing(1),
    alignItems: 'flex-end',
    flexWrap: 'wrap',
    marginBottom: theme.spacing(0.5),
  }),
  grow: css({ flex: '1 1 140px', marginBottom: 0 }),
  growWide: css({ flex: '2 1 220px', marginBottom: 0 }),
});
