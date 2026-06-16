// LayerControl — an on-map overlay that lists the configured layers (grouped by
// their `group` field) with a checkbox each to show/hide them. Rendered by
// VectormapPanel as an absolutely-positioned box over the map. It's a "dumb"
// component: it receives the layers + current visibility + a toggle callback,
// and the panel owns the actual MapLibre visibility changes.

import React from 'react';
import { GrafanaTheme2 } from '@grafana/data';
import { useStyles2, useTheme2 } from '@grafana/ui';
import { css } from '@emotion/css';
import { VectorTileLayerConfig } from '../types';

interface Props {
  layers: VectorTileLayerConfig[];
  visibility: Record<string, boolean>;
  onToggle: (layerId: string, visible: boolean) => void;
}

// The color swatch for a layer = the paint color matching its geometry type,
// resolved from Grafana's palette to a real CSS color.
const swatchColor = (layer: VectorTileLayerConfig, resolve: (c: string) => string): string => {
  if (layer.geometryType === 'fill') {
    return resolve(layer.fillColor || '#3388ff');
  }
  if (layer.geometryType === 'circle') {
    return resolve(layer.circleColor || '#1f77b4');
  }
  return resolve(layer.lineColor || '#ff5722');
};

export const LayerControl: React.FC<Props> = ({ layers, visibility, onToggle }) => {
  const styles = useStyles2(getStyles);
  const theme = useTheme2();

  // Only show layers that are actually drawable (have a URL + source layer).
  const usable = layers.filter((l) => l.tileUrl && l.sourceLayer);
  if (usable.length === 0) {
    return null;
  }

  // Group layers by their `group` field, preserving first-seen order.
  const groups: Array<{ name: string; items: VectorTileLayerConfig[] }> = [];
  for (const layer of usable) {
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
              <span className={styles.swatch} style={{ backgroundColor: swatchColor(layer, theme.visualization.getColorByName) }} />
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
  groupLabel: css({ color: theme.colors.text.secondary, fontSize: theme.typography.bodySmall.fontSize, marginTop: theme.spacing(0.5) }),
  item: css({ display: 'flex', alignItems: 'center', gap: theme.spacing(0.5), cursor: 'pointer', lineHeight: 1.8 }),
  swatch: css({ display: 'inline-block', width: 12, height: 12, borderRadius: 2, flexShrink: 0 }),
  name: css({ whiteSpace: 'nowrap' }),
});
