// LayerControl — an on-map overlay that lists the map's layers (grouped by their
// `group` field) with a checkbox each to show/hide them. Rendered by
// VectormapPanel as an absolutely-positioned box over the map.
//
// It's a "dumb" component working on a NORMALIZED list (ControlLayer): the panel
// flattens both vector tile layers AND marker (query) layers into this one shape
// so they share a single grouped control. The panel owns the actual MapLibre
// visibility changes; this just reports toggles.

import React from 'react';
import { GrafanaTheme2 } from '@grafana/data';
import { useStyles2, useTheme2 } from '@grafana/ui';
import { css } from '@emotion/css';

// One entry in the control, regardless of whether it's a tile or marker layer.
export interface ControlLayer {
  id: string; // stable layer id (also the visibility key)
  name: string; // display name
  group: string; // group heading ('' = ungrouped)
  color: string; // swatch color (may be a Grafana named palette color)
}

interface Props {
  layers: ControlLayer[];
  visibility: Record<string, boolean>;
  onToggle: (layerId: string, visible: boolean) => void;
}

export const LayerControl: React.FC<Props> = ({ layers, visibility, onToggle }) => {
  const styles = useStyles2(getStyles);
  const theme = useTheme2();

  if (layers.length === 0) {
    return null;
  }

  // Group by the `group` field, preserving first-seen order.
  const groups: Array<{ name: string; items: ControlLayer[] }> = [];
  for (const layer of layers) {
    const name = layer.group || '';
    let g = groups.find((x) => x.name === name);
    if (!g) {
      g = { name, items: [] };
      groups.push(g);
    }
    g.items.push(layer);
  }

  return (
    <div className={styles.container}>
      <div className={styles.title}>Layers</div>
      {groups.map((group) => (
        <div key={group.name || '_ungrouped'} className={styles.group}>
          {group.name && <div className={styles.groupLabel}>{group.name}</div>}
          {group.items.map((layer) => (
            <label key={layer.id} className={styles.item}>
              <input
                type="checkbox"
                checked={visibility[layer.id] !== false}
                onChange={(e) => onToggle(layer.id, e.currentTarget.checked)}
              />
              <span
                className={styles.swatch}
                style={{ backgroundColor: theme.visualization.getColorByName(layer.color) }}
              />
              <span className={styles.name}>{layer.name || layer.id}</span>
            </label>
          ))}
        </div>
      ))}
    </div>
  );
};

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    position: 'absolute',
    bottom: theme.spacing(1),
    left: theme.spacing(1),
    zIndex: 1,
    background: theme.colors.background.primary,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: 2,
    padding: theme.spacing(1),
    maxHeight: '45%',
    overflow: 'auto',
    fontSize: theme.typography.bodySmall.fontSize,
    boxShadow: theme.shadows.z1,
  }),
  title: css({ fontWeight: theme.typography.fontWeightMedium, marginBottom: theme.spacing(0.5) }),
  group: css({ marginBottom: theme.spacing(0.5) }),
  groupLabel: css({
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    marginTop: theme.spacing(0.5),
  }),
  item: css({ display: 'flex', alignItems: 'center', gap: theme.spacing(0.5), cursor: 'pointer', lineHeight: 1.8 }),
  swatch: css({ display: 'inline-block', width: 12, height: 12, borderRadius: 2, flexShrink: 0 }),
  name: css({ whiteSpace: 'nowrap' }),
});
