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
import { MarkerShape } from '../types';

// Icon drawn next to a layer in the legend. Marker layers use their MarkerShape
// so the legend matches the map; vector tile layers use 'line' (a bar) or a
// 'square'/'circle' for fill/circle geometry.
export type LegendShape = MarkerShape | 'line';

// One entry in the control, regardless of whether it's a tile or marker layer.
export interface ControlLayer {
  id: string; // stable layer id (also the visibility key)
  name: string; // display name
  group: string; // group heading ('' = ungrouped)
  color: string; // swatch color (may be a Grafana named palette color)
  shape: LegendShape; // legend icon shape (matches what's drawn on the map)
}

// --- Legend icon -----------------------------------------------------------
// SVG points for a regular n-gon (first vertex at startDeg; -90 = pointing up).
const polyPoints = (n: number, startDeg: number, r: number, cx = 8, cy = 8): string =>
  Array.from({ length: n }, (_, i) => {
    const a = ((startDeg + (i * 360) / n) * Math.PI) / 180;
    return `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
  }).join(' ');

// SVG points for a 5-point star.
const starPoints = (cx = 8, cy = 8, ro = 7, ri = 3): string =>
  Array.from({ length: 10 }, (_, i) => {
    const r = i % 2 ? ri : ro;
    const a = ((-90 + i * 36) * Math.PI) / 180;
    return `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
  }).join(' ');

// A small SVG icon matching the shape drawn on the map, filled with the layer's
// color. This is what makes the legend match the markers (the bug fix).
const ShapeSwatch: React.FC<{ shape: LegendShape; color: string }> = ({ shape, color }) => {
  const common = { width: 14, height: 14, viewBox: '0 0 16 16', style: { flexShrink: 0, display: 'block' } };
  switch (shape) {
    case 'square':
      return (
        <svg {...common}>
          <rect x="2" y="2" width="12" height="12" rx="1" fill={color} />
        </svg>
      );
    case 'triangle':
      return (
        <svg {...common}>
          <polygon points={polyPoints(3, -90, 7.5)} fill={color} />
        </svg>
      );
    case 'diamond':
      return (
        <svg {...common}>
          <polygon points={polyPoints(4, -90, 7)} fill={color} />
        </svg>
      );
    case 'hexagon':
      return (
        <svg {...common}>
          <polygon points={polyPoints(6, -90, 7)} fill={color} />
        </svg>
      );
    case 'star':
      return (
        <svg {...common}>
          <polygon points={starPoints()} fill={color} />
        </svg>
      );
    case 'cross':
      return (
        <svg {...common}>
          <polygon
            points="5.6,1.5 10.4,1.5 10.4,5.6 14.5,5.6 14.5,10.4 10.4,10.4 10.4,14.5 5.6,14.5 5.6,10.4 1.5,10.4 1.5,5.6 5.6,5.6"
            fill={color}
          />
        </svg>
      );
    case 'line':
      return (
        <svg {...common}>
          <rect x="1" y="6.5" width="14" height="3" rx="1.5" fill={color} />
        </svg>
      );
    case 'circle':
    default:
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6.5" fill={color} />
        </svg>
      );
  }
};

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
              <ShapeSwatch shape={layer.shape} color={theme.visualization.getColorByName(layer.color)} />
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
  name: css({ whiteSpace: 'nowrap' }),
});
