// AnnotationEditor — a compact floating panel to manage the session-only temp
// markers ("Annotations"). Lists the markers, lets you edit the selected one's
// name / note / color / icon, and delete it. Shown while placing markers or when
// a marker is selected. State lives in VectormapPanel; this is presentational.

import React from 'react';
import { GrafanaTheme2 } from '@grafana/data';
import { Button, ColorPicker, Field, IconButton, Input, TextArea, useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';
import { IconPicker } from './IconPicker';

// A user-placed temp marker. Owned here so the editor and panel share one shape.
export interface Annotation {
  id: string;
  lng: number;
  lat: number;
  name: string;
  note: string;
  color: string;
  icon: string; // icon id from src/icons.ts
}

interface Props {
  annotations: Annotation[];
  selectedId: string | null;
  addMode: boolean;
  onSelect: (id: string) => void;
  onUpdate: (id: string, patch: Partial<Annotation>) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}

export const AnnotationEditor: React.FC<Props> = ({
  annotations,
  selectedId,
  addMode,
  onSelect,
  onUpdate,
  onRemove,
  onClose,
}) => {
  const styles = useStyles2(getStyles);
  const selected = annotations.find((a) => a.id === selectedId) ?? null;

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <strong>Markers</strong>
        <span className={styles.count}>{annotations.length}</span>
        <IconButton name="times" aria-label="Close markers panel" onClick={onClose} />
      </div>

      {addMode && <div className={styles.hint}>Click the map to place a marker.</div>}

      {annotations.length > 0 && (
        <div className={styles.list}>
          {annotations.map((a) => (
            <button
              type="button"
              key={a.id}
              className={a.id === selectedId ? styles.rowActive : styles.row}
              onClick={() => onSelect(a.id)}
            >
              {a.name || '(unnamed)'}
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div className={styles.editor}>
          <Field label="Name" className={styles.field}>
            <Input value={selected.name} onChange={(e) => onUpdate(selected.id, { name: e.currentTarget.value })} />
          </Field>
          <Field label="Note" className={styles.field}>
            <TextArea
              rows={2}
              value={selected.note}
              placeholder="e.g. work order or comment"
              onChange={(e) => onUpdate(selected.id, { note: e.currentTarget.value })}
            />
          </Field>
          <div className={styles.iconColor}>
            <Field label="Icon" className={styles.grow}>
              <IconPicker value={selected.icon || 'pin'} onChange={(icon) => onUpdate(selected.id, { icon })} />
            </Field>
            <Field label="Color">
              <ColorPicker color={selected.color || '#1f77b4'} onChange={(color) => onUpdate(selected.id, { color })} />
            </Field>
          </div>
          <Button size="sm" variant="destructive" fill="text" icon="trash-alt" onClick={() => onRemove(selected.id)}>
            Delete marker
          </Button>
        </div>
      )}
    </div>
  );
};

const getStyles = (theme: GrafanaTheme2) => ({
  wrap: css({
    position: 'absolute',
    top: 52,
    left: theme.spacing(1),
    zIndex: 2,
    // User-resizable: drag the bottom-right corner. Defaults + sensible bounds.
    width: 330,
    height: 430,
    minWidth: 240,
    minHeight: 180,
    maxWidth: '90%',
    maxHeight: '85%',
    resize: 'both',
    overflow: 'auto',
    padding: theme.spacing(1),
    background: theme.colors.background.primary,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    boxShadow: theme.shadows.z3,
  }),
  header: css({ display: 'flex', alignItems: 'center', gap: theme.spacing(1), marginBottom: theme.spacing(0.5) }),
  count: css({ marginLeft: 'auto', color: theme.colors.text.secondary, fontSize: theme.typography.bodySmall.fontSize }),
  hint: css({ color: theme.colors.text.secondary, fontSize: theme.typography.bodySmall.fontSize, marginBottom: theme.spacing(0.5) }),
  list: css({ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: theme.spacing(1), maxHeight: 120, overflowY: 'auto' }),
  row: css({
    textAlign: 'left',
    border: 'none',
    background: 'none',
    color: theme.colors.text.primary,
    padding: theme.spacing(0.25, 0.5),
    borderRadius: theme.shape.radius.default,
    cursor: 'pointer',
    '&:hover': { background: theme.colors.action.hover },
  }),
  rowActive: css({
    textAlign: 'left',
    border: 'none',
    background: theme.colors.action.selected,
    color: theme.colors.text.primary,
    padding: theme.spacing(0.25, 0.5),
    borderRadius: theme.shape.radius.default,
    cursor: 'pointer',
  }),
  editor: css({ borderTop: `1px solid ${theme.colors.border.weak}`, paddingTop: theme.spacing(1) }),
  field: css({ marginBottom: theme.spacing(1) }),
  iconColor: css({ display: 'flex', gap: theme.spacing(1), alignItems: 'flex-start', marginBottom: theme.spacing(1) }),
  grow: css({ flex: 1, marginBottom: 0 }),
});
