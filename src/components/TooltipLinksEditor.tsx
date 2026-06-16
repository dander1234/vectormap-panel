// TooltipLinksEditor — a small reusable editor for a layer's tooltip links
// (the `tooltipLinks` array). Used by BOTH the tile-layer editor and the marker-
// layer editor so the two stay consistent.
//
// Each link is { label, url, openInNewTab }. The `url` is a template: it can
// contain ${fieldName} placeholders (filled from the clicked feature's own
// attributes at click time) and Grafana template variables (filled by Grafana).
// This component only edits the templates; the substitution happens in the panel.
//
// Like the other editors, it never mutates the array in place — every change
// builds a NEW array via onChange.

import React from 'react';
import { GrafanaTheme2 } from '@grafana/data';
import { Button, Field, Input, Switch, useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';
import { TooltipLink } from '../types';

interface Props {
  value: TooltipLink[];
  onChange: (links: TooltipLink[]) => void;
}

export const TooltipLinksEditor: React.FC<Props> = ({ value, onChange }) => {
  const styles = useStyles2(getStyles);
  const links = value ?? [];

  const update = (index: number, patch: Partial<TooltipLink>) =>
    onChange(links.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  const add = () => onChange([...links, { label: 'Open link', url: '', openInNewTab: true }]);
  const remove = (index: number) => onChange(links.filter((_, i) => i !== index));

  return (
    <div className={styles.wrap}>
      <div className={styles.hint}>
        Links shown at the bottom of this layer’s tooltip. URL supports{' '}
        <code>{'${field_name}'}</code> placeholders (from the clicked row) and Grafana variables.
      </div>
      {links.map((link, i) => (
        <div key={i} className={styles.row}>
          <Field label="Link text" className={styles.grow}>
            <Input value={link.label} onChange={(e) => update(i, { label: e.currentTarget.value })} />
          </Field>
          <Field
            label="URL template"
            className={styles.grow}
            description="e.g. https://crm.example.com/cust/${name}"
          >
            <Input
              value={link.url}
              placeholder="https://…/${field}"
              onChange={(e) => update(i, { url: e.currentTarget.value })}
            />
          </Field>
          <Field label="New tab">
            <Switch value={link.openInNewTab} onChange={(e) => update(i, { openInNewTab: e.currentTarget.checked })} />
          </Field>
          <Button size="sm" variant="destructive" fill="text" onClick={() => remove(i)} title="Remove link">
            ✕
          </Button>
        </div>
      ))}
      <Button icon="plus" size="sm" variant="secondary" onClick={add}>
        Add link
      </Button>
    </div>
  );
};

const getStyles = (theme: GrafanaTheme2) => ({
  wrap: css({ marginTop: theme.spacing(0.5) }),
  hint: css({ color: theme.colors.text.secondary, fontSize: theme.typography.bodySmall.fontSize, marginBottom: theme.spacing(0.5) }),
  row: css({
    display: 'flex',
    gap: theme.spacing(1),
    alignItems: 'flex-end',
    flexWrap: 'wrap',
    marginBottom: theme.spacing(0.5),
  }),
  grow: css({ flex: '1 1 180px', marginBottom: 0 }),
});
