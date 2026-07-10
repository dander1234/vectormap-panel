// LayerOrganizerEditor — drag-and-drop editor for the layer control's MENU order.
//
// Bound to the `layerOrder` option. It reads the live layers from
// context.options (tile + marker) to know the current groups and their members,
// renders them as a grouped tree in the current effective order, and lets you:
//   • drag a GROUP header to reorder the categories, and
//   • drag a LAYER row to reorder it within its own group.
// Moving a layer BETWEEN groups is intentionally not supported here — category
// membership stays each layer's `group` field (per the feature's scope). This
// only affects the on-map control's display order, never the map's draw order.
//
// Uses native HTML5 drag-and-drop (no extra dependency). On every drop it writes
// the COMPLETE reconciled group/item order so the control renders deterministically.

import React, { useRef } from 'react';
import { StandardEditorProps, GrafanaTheme2 } from '@grafana/data';
import { Checkbox, Icon, useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';
import { LayerOrder, VectormapOptions } from '../types';
import { orderByKey } from '../layerControl';

type Props = StandardEditorProps<LayerOrder, unknown, VectormapOptions>;

interface Item {
  id: string;
  name: string;
}
interface Group {
  name: string; // '' = ungrouped
  items: Item[];
}

// What is currently being dragged (kept in a ref so dragging doesn't re-render).
type Drag = { type: 'group'; index: number } | { type: 'item'; group: string; index: number };

// Move an array element from `from` to `to` (immutably).
const arrayMove = <T,>(arr: T[], from: number, to: number): T[] => {
  const next = [...arr];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
};

export const LayerOrganizerEditor: React.FC<Props> = ({ value, onChange, context }) => {
  const styles = useStyles2(getStyles);
  const dragRef = useRef<Drag | null>(null);

  // Build the current group tree from the live layers (mirrors LayerControl:
  // drawable tile layers + all marker layers), then apply the stored order.
  const tile = (context.options?.layers ?? [])
    .filter((l) => l.tileUrl && l.sourceLayer)
    .map((l) => ({ id: l.id, name: l.name || l.id, group: l.group || '' }));
  const markers = (context.options?.markerLayers ?? []).map((l) => ({
    id: l.id,
    name: l.name || l.id,
    group: l.group || '',
  }));
  const all = [...tile, ...markers];

  const groups: Group[] = [];
  for (const l of all) {
    let g = groups.find((x) => x.name === l.group);
    if (!g) {
      g = { name: l.group, items: [] };
      groups.push(g);
    }
    g.items.push({ id: l.id, name: l.name });
  }
  const order = value ?? { groupOrder: [], itemOrder: [], collapsedGroups: [] };
  const collapsedGroups = order.collapsedGroups ?? [];
  const display = orderByKey(groups, (g) => g.name, order.groupOrder ?? []).map((g) => ({
    ...g,
    items: orderByKey(g.items, (i) => i.id, order.itemOrder ?? []),
  }));

  // Persist a new tree (complete groupOrder + itemOrder) plus the collapsed set.
  const write = (next: Group[], collapsed: string[]) =>
    onChange({
      groupOrder: next.map((g) => g.name),
      itemOrder: next.flatMap((g) => g.items.map((i) => i.id)),
      collapsedGroups: collapsed,
    });

  const moveGroup = (from: number, to: number) => {
    if (from !== to) {
      write(arrayMove(display, from, to), collapsedGroups);
    }
  };
  const moveItem = (groupName: string, from: number, to: number) => {
    if (from === to) {
      return;
    }
    write(display.map((g) => (g.name === groupName ? { ...g, items: arrayMove(g.items, from, to) } : g)), collapsedGroups);
  };
  const toggleCollapsed = (groupName: string) => {
    const next = collapsedGroups.includes(groupName)
      ? collapsedGroups.filter((n) => n !== groupName)
      : [...collapsedGroups, groupName];
    write(display, next);
  };

  const onGroupDrop = (targetIndex: number) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d?.type === 'group') {
      moveGroup(d.index, targetIndex);
    }
  };
  const onItemDrop = (groupName: string, targetIndex: number) => {
    const d = dragRef.current;
    dragRef.current = null;
    // Only reorder within the SAME group (membership is the layer's Group field).
    if (d?.type === 'item' && d.group === groupName) {
      moveItem(groupName, d.index, targetIndex);
    }
  };
  const allow = (e: React.DragEvent) => e.preventDefault(); // permit drop

  if (all.length === 0) {
    return <div className={styles.hint}>Add tile or marker layers first, then arrange them here.</div>;
  }

  return (
    <div>
      <div className={styles.hint}>
        Drag a group to reorder categories, or a layer to reorder it within its
        group. This sets the on-map layer menu order only — it doesn’t change map
        draw order or which category a layer belongs to (set that with the layer’s
        Group field).
      </div>
      {display.map((group, gi) => (
        <div key={group.name || '_ungrouped'} className={styles.group}>
          <div className={styles.groupHeader} onDragOver={allow} onDrop={() => onGroupDrop(gi)}>
            {/* Only the handle+name is draggable, so the checkbox click doesn't
                start a drag. */}
            <div
              className={styles.groupHandle}
              draggable
              onDragStart={(e) => {
                dragRef.current = { type: 'group', index: gi };
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', group.name);
              }}
            >
              <Icon name="draggabledots" className={styles.handle} />
              <strong>{group.name || '(Ungrouped)'}</strong>
              <span className={styles.count}>{group.items.length}</span>
            </div>
            {group.name !== '' && (
              <Checkbox
                label="Collapsed"
                value={collapsedGroups.includes(group.name)}
                onChange={() => toggleCollapsed(group.name)}
              />
            )}
          </div>
          {group.items.map((item, ii) => (
            <div
              key={item.id}
              className={styles.item}
              draggable
              onDragStart={(e) => {
                dragRef.current = { type: 'item', group: group.name, index: ii };
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', item.id);
              }}
              onDragOver={allow}
              onDrop={() => onItemDrop(group.name, ii)}
            >
              <Icon name="draggabledots" className={styles.handle} />
              <span className={styles.itemName}>{item.name}</span>
            </div>
          ))}
          {/* Trailing drop zone: place a dragged layer at the end of this group. */}
          <div className={styles.endZone} onDragOver={allow} onDrop={() => onItemDrop(group.name, group.items.length)} />
        </div>
      ))}
      {/* Trailing drop zone: place a dragged group at the very end. */}
      <div className={styles.endZone} onDragOver={allow} onDrop={() => onGroupDrop(display.length)} />
    </div>
  );
};

const getStyles = (theme: GrafanaTheme2) => ({
  hint: css({
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    marginBottom: theme.spacing(1),
  }),
  group: css({
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    padding: theme.spacing(0.5),
    marginBottom: theme.spacing(0.5),
  }),
  groupHeader: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(1),
    padding: theme.spacing(0.5),
    background: theme.colors.background.secondary,
    borderRadius: theme.shape.radius.default,
  }),
  groupHandle: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    flex: 1,
    minWidth: 0,
    cursor: 'grab',
  }),
  count: css({ marginLeft: 'auto', color: theme.colors.text.secondary, fontSize: theme.typography.bodySmall.fontSize }),
  item: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(0.5, 0.5, 0.5, 2),
    cursor: 'grab',
    '&:hover': { background: theme.colors.action.hover },
  }),
  itemName: css({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }),
  handle: css({ color: theme.colors.text.secondary, cursor: 'grab' }),
  endZone: css({ height: theme.spacing(1) }),
});
