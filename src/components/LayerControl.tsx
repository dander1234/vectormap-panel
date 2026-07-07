// LayerControl — an on-map overlay that lists the map's layers (grouped by their
// `group` field) with a checkbox each to show/hide them. Rendered by
// VectormapPanel as an absolutely-positioned box over the map.
//
// It's a "dumb" component working on a NORMALIZED list (ControlLayer): the panel
// flattens both vector tile layers AND marker (query) layers into this one shape
// so they share a single grouped control. The panel owns the actual MapLibre
// visibility changes; this just reports toggles.

import React, { useEffect, useRef } from 'react';
import { GrafanaTheme2 } from '@grafana/data';
import { useStyles2, useTheme2 } from '@grafana/ui';
import { css } from '@emotion/css';
import { MarkerShape, MarkerLabelView } from '../types';
import { groupCheckState } from '../layerControl';

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
  // Marker layers only: optional viewer-selectable text label views. When set,
  // this layer's row shows a dropdown to switch how its points are labeled.
  labelViews?: MarkerLabelView[];
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

// A group heading + its checkbox. Split out so the indeterminate ("mixed") state
// can be applied to the DOM input via a ref — `indeterminate` is not a React prop.
const GroupCheckbox: React.FC<{
  state: 'on' | 'off' | 'mixed';
  onChange: (visible: boolean) => void;
}> = ({ state, onChange }) => {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = state === 'mixed';
    }
  }, [state]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={state === 'on'}
      // Clicking a mixed/off box turns the group ON; an on box turns it OFF.
      onChange={() => onChange(state !== 'on')}
    />
  );
};

interface Props {
  layers: ControlLayer[];
  visibility: Record<string, boolean>;
  onToggle: (layerId: string, visible: boolean) => void;
  onToggleGroup: (groupName: string, visible: boolean) => void;
  // Active label view per marker layer id ('' / missing = "Markers" = dot only).
  activeLabelView: Record<string, string>;
  onSelectLabelView: (layerId: string, viewName: string) => void;
}

export const LayerControl: React.FC<Props> = ({
  layers,
  visibility,
  onToggle,
  onToggleGroup,
  activeLabelView,
  onSelectLabelView,
}) => {
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
          {group.name && (
            <label className={styles.groupLabel}>
              {/* One checkbox toggles every layer in this group at once. */}
              <GroupCheckbox
                state={groupCheckState(group.items.map((l) => l.id), visibility)}
                onChange={(visible) => onToggleGroup(group.name, visible)}
              />
              <span>{group.name}</span>
            </label>
          )}
          {group.items.map((layer) => (
            <div key={layer.id}>
              <label className={styles.item}>
                <input
                  type="checkbox"
                  checked={visibility[layer.id] !== false}
                  onChange={(e) => onToggle(layer.id, e.currentTarget.checked)}
                />
                <ShapeSwatch shape={layer.shape} color={theme.visualization.getColorByName(layer.color)} />
                <span className={styles.name}>{layer.name || layer.id}</span>
              </label>
              {layer.labelViews && layer.labelViews.length > 0 && (
                <select
                  className={styles.labelSelect}
                  value={activeLabelView[layer.id] ?? ''}
                  onChange={(e) => onSelectLabelView(layer.id, e.currentTarget.value)}
                  title="Point label"
                >
                  {/* Implicit default: the colored dot only (current behavior). */}
                  <option value="">Markers</option>
                  {layer.labelViews.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
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
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    marginTop: theme.spacing(0.5),
    cursor: 'pointer',
  }),
  item: css({ display: 'flex', alignItems: 'center', gap: theme.spacing(0.5), cursor: 'pointer', lineHeight: 1.8 }),
  name: css({ whiteSpace: 'nowrap' }),
  // The per-marker-layer "point label" dropdown, indented under its layer row.
  labelSelect: css({
    marginLeft: theme.spacing(2.5),
    marginBottom: theme.spacing(0.25),
    maxWidth: 160,
    background: theme.colors.background.secondary,
    color: theme.colors.text.primary,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
});
