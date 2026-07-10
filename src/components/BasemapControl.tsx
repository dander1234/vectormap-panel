// BasemapControl — a compact on-map picker that lets a viewer switch between the
// admin-curated basemaps (options.basemapChoices). Rendered by VectormapPanel in
// the bottom-right corner when at least one choice is configured. The panel owns
// the actual basemap swap; this just reports the chosen index.

import React from 'react';
import { GrafanaTheme2, SelectableValue } from '@grafana/data';
import { Select, useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';
import { BasemapChoice } from '../types';

interface Props {
  choices: BasemapChoice[];
  activeIndex: number;
  onChange: (index: number) => void;
}

export const BasemapControl: React.FC<Props> = ({ choices, activeIndex, onChange }) => {
  const styles = useStyles2(getStyles);
  if (choices.length === 0) {
    return null;
  }
  const options: Array<SelectableValue<number>> = choices.map((c, i) => ({
    label: c.label || `Basemap ${i + 1}`,
    value: i,
  }));
  return (
    <div className={styles.wrap}>
      <span className={styles.label}>Basemap</span>
      <div className={styles.select}>
        <Select
          options={options}
          value={activeIndex}
          onChange={(v: SelectableValue<number>) => onChange(v?.value ?? 0)}
          size="sm"
          isSearchable={false}
          aria-label="Basemap"
        />
      </div>
    </div>
  );
};

const getStyles = (theme: GrafanaTheme2) => ({
  wrap: css({
    position: 'absolute',
    bottom: theme.spacing(1),
    right: theme.spacing(1),
    zIndex: 1,
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    background: theme.colors.background.primary,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: 2,
    padding: theme.spacing(0.5, 1),
    boxShadow: theme.shadows.z1,
  }),
  label: css({
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
  }),
  select: css({ width: 150 }),
});
