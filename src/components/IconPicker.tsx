// IconPicker — a searchable grid popover for choosing a marker icon.
//
// Shows the current icon + name as a button; clicking opens a popover with a
// search box (filters by name + keywords via searchIcons) over a grid of icon
// thumbnails grouped by category. Selecting one reports its id and closes. The
// overlay pattern (relative container + absolute panel, close on outside-click /
// Escape) mirrors SearchBox.tsx.

import React, { useEffect, useRef, useState } from 'react';
import { GrafanaTheme2 } from '@grafana/data';
import { Icon, Input, useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';
import { MarkerIcon, IconCategory, iconById, searchIcons } from '../icons';

interface Props {
  value: string;
  onChange: (id: string) => void;
}

const CATEGORY_LABEL: Record<IconCategory, string> = {
  geometric: 'Geometric',
  general: 'General',
  telecom: 'Telecom / fiber',
};
const CATEGORY_ORDER: IconCategory[] = ['telecom', 'general', 'geometric'];

// A monochrome icon glyph filled with the current text color.
const Glyph: React.FC<{ icon: MarkerIcon; size?: number }> = ({ icon, size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: 'block', fill: 'currentColor' }}>
    <path d={icon.path} fillRule={icon.fillRule ?? 'nonzero'} />
  </svg>
);

export const IconPicker: React.FC<Props> = ({ value, onChange }) => {
  const styles = useStyles2(getStyles);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape while open.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const current = iconById(value) ?? iconById('circle')!;
  const results = searchIcons(query);
  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
    setQuery('');
  };

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button type="button" className={styles.trigger} onClick={() => setOpen((o) => !o)}>
        <span className={styles.triggerIcon}>
          <Glyph icon={current} />
        </span>
        <span className={styles.triggerName}>{current.name}</span>
        <Icon name={open ? 'angle-up' : 'angle-down'} />
      </button>

      {open && (
        <div className={styles.popover}>
          <Input
            autoFocus
            value={query}
            placeholder="Search icons (e.g. vault, ONT, cabinet)…"
            onChange={(e) => setQuery(e.currentTarget.value)}
          />
          <div className={styles.scroll}>
            {results.length === 0 && <div className={styles.empty}>No icons match “{query}”.</div>}
            {CATEGORY_ORDER.map((cat) => {
              const items = results.filter((i) => i.category === cat);
              if (items.length === 0) {
                return null;
              }
              return (
                <div key={cat}>
                  <div className={styles.catLabel}>{CATEGORY_LABEL[cat]}</div>
                  <div className={styles.grid}>
                    {items.map((icon) => (
                      <button
                        type="button"
                        key={icon.id}
                        className={icon.id === value ? styles.cellActive : styles.cell}
                        title={`${icon.name} — ${icon.keywords.join(', ')}`}
                        onClick={() => pick(icon.id)}
                      >
                        <Glyph icon={icon} />
                        <span className={styles.cellName}>{icon.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

const getStyles = (theme: GrafanaTheme2) => ({
  wrap: css({ position: 'relative' }),
  trigger: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    width: '100%',
    padding: theme.spacing(0.5, 1),
    background: theme.components.input.background,
    border: `1px solid ${theme.components.input.borderColor}`,
    borderRadius: theme.shape.radius.default,
    color: theme.colors.text.primary,
    cursor: 'pointer',
    textAlign: 'left',
  }),
  triggerIcon: css({ display: 'flex', color: theme.colors.text.primary }),
  triggerName: css({ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }),
  popover: css({
    position: 'absolute',
    zIndex: theme.zIndex.dropdown,
    top: '100%',
    left: 0,
    marginTop: theme.spacing(0.5),
    width: 320,
    maxWidth: '90vw',
    padding: theme.spacing(1),
    background: theme.colors.background.primary,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    boxShadow: theme.shadows.z3,
  }),
  scroll: css({ maxHeight: 300, overflowY: 'auto', marginTop: theme.spacing(1) }),
  empty: css({ color: theme.colors.text.secondary, padding: theme.spacing(1) }),
  catLabel: css({
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    margin: theme.spacing(0.5, 0, 0.5),
  }),
  grid: css({
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))',
    gap: theme.spacing(0.5),
    marginBottom: theme.spacing(1),
  }),
  cell: css({
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: theme.spacing(0.25),
    padding: theme.spacing(0.5, 0.25),
    border: `1px solid transparent`,
    borderRadius: theme.shape.radius.default,
    background: 'none',
    color: theme.colors.text.primary,
    cursor: 'pointer',
    '&:hover': { background: theme.colors.action.hover },
  }),
  cellActive: css({
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: theme.spacing(0.25),
    padding: theme.spacing(0.5, 0.25),
    border: `1px solid ${theme.colors.primary.border}`,
    borderRadius: theme.shape.radius.default,
    background: theme.colors.action.selected,
    color: theme.colors.text.primary,
    cursor: 'pointer',
  }),
  cellName: css({
    fontSize: theme.typography.size.xs,
    color: theme.colors.text.secondary,
    textAlign: 'center',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: '100%',
  }),
});
