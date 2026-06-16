// ColorRulesEditor — edits a marker layer's color rules for the 'thresholds' and
// 'regex' color modes. Each rule pairs a match (a numeric threshold or a regex
// pattern) with a color. Reused inside MarkerLayersEditor.
//
// The `mode` prop only changes the labels/inputs; the stored shape is the same
// MarkerColorRule either way. Never mutates the array in place.

import React from 'react';
import { GrafanaTheme2 } from '@grafana/data';
import { Button, ColorPicker, Field, Input, useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';
import { MarkerColorRule } from '../types';

interface Props {
  value: MarkerColorRule[];
  mode: 'thresholds' | 'regex';
  onChange: (rules: MarkerColorRule[]) => void;
}

export const ColorRulesEditor: React.FC<Props> = ({ value, mode, onChange }) => {
  const styles = useStyles2(getStyles);
  const rules = value ?? [];

  const update = (index: number, patch: Partial<MarkerColorRule>) =>
    onChange(rules.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  const add = () => onChange([...rules, { match: '', color: '#73bf69' }]);
  const remove = (index: number) => onChange(rules.filter((_, i) => i !== index));

  const isThreshold = mode === 'thresholds';

  return (
    <div className={styles.wrap}>
      <div className={styles.hint}>
        {isThreshold
          ? 'A point gets the color of the highest threshold that is ≤ its value. Values below every threshold use the fixed/fallback color.'
          : 'A point gets the color of the first pattern (case-insensitive regex) that matches its value. No match uses the fixed/fallback color.'}
      </div>
      {rules.map((rule, i) => (
        <div key={i} className={styles.row}>
          <Field label={isThreshold ? 'Value ≥' : 'Pattern (regex)'} className={styles.grow}>
            <Input
              type={isThreshold ? 'number' : 'text'}
              value={rule.match}
              placeholder={isThreshold ? 'e.g. -25' : 'e.g. ^missing$|los'}
              onChange={(e) => update(i, { match: e.currentTarget.value })}
            />
          </Field>
          <Field label="Color">
            <ColorPicker color={rule.color} onChange={(c) => update(i, { color: c })} />
          </Field>
          <Button size="sm" variant="destructive" fill="text" onClick={() => remove(i)} title="Remove rule">
            ✕
          </Button>
        </div>
      ))}
      <Button icon="plus" size="sm" variant="secondary" onClick={add}>
        Add rule
      </Button>
    </div>
  );
};

const getStyles = (theme: GrafanaTheme2) => ({
  wrap: css({ marginTop: theme.spacing(0.5) }),
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
  grow: css({ flex: '1 1 160px', marginBottom: 0 }),
});
