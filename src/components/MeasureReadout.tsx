// MeasureReadout — the running distance display for the ruler tool, shown in the
// map toolbar while measuring. The panel computes the formatted text (both units);
// this just renders it with a Clear button.

import React from 'react';
import { GrafanaTheme2 } from '@grafana/data';
import { Button, IconButton, useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';

interface Props {
  text: string; // e.g. "1,240 ft (378 m)"
  onClear: () => void;
  // Pin the current measurement to the map. Undefined until the path has ≥2 points.
  onHold?: () => void;
}

export const MeasureReadout: React.FC<Props> = ({ text, onClear, onHold }) => {
  const styles = useStyles2(getStyles);
  return (
    <div className={styles.wrap}>
      <span className={styles.text}>{text}</span>
      {onHold && (
        <Button size="sm" variant="secondary" fill="text" onClick={onHold} title="Keep this measurement on the map">
          Hold
        </Button>
      )}
      <IconButton name="times" aria-label="Clear measurement" tooltip="Clear (Esc)" onClick={onClear} />
    </div>
  );
};

const getStyles = (theme: GrafanaTheme2) => ({
  wrap: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    padding: theme.spacing(0.25, 0.75),
    background: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
  }),
  text: css({
    fontVariantNumeric: 'tabular-nums',
    fontWeight: theme.typography.fontWeightMedium,
    whiteSpace: 'nowrap',
  }),
});
