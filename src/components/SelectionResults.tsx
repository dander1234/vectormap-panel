// SelectionResults — the "Select area" results window.
//
// A floating, draggable, resizable window that sits OVER the map inside the
// Vectormap panel. The user can move it by its title bar and resize it from any
// edge or corner; it's always clamped to stay within the panel. It receives an
// already-computed SelectionResult (the panel runs the query) and renders the
// selected features grouped by layer.
//
// It is "dumb": it does no querying. Field selection for the table columns reuses
// selectTooltipFields (the same helper the click popup uses), so the columns here
// always match what a feature's tooltip would show for that layer.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { GrafanaTheme2 } from '@grafana/data';
import { Button, IconButton, Icon, useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';
import {
  SelectionResult,
  SelectedLayerGroup,
  selectTooltipFields,
  selectionToCsv,
  selectionToPlainTable,
  selectionToHtmlTable,
} from '../selection';
import { TooltipLink } from '../types';
import { linkPlaceholderFields, resolveLink } from '../links';

interface Props {
  result: SelectionResult;
  // Clear the selection (and the map highlight) — owned by the panel.
  onClose: () => void;
  // Panel size in pixels — used to place/clamp the floating window so it never
  // leaves the panel.
  width: number;
  height: number;
  // Grafana variable interpolation, applied when filling a layer's link URLs.
  replaceVariables: (s: string) => string;
}

// The window's position + size in pixels, relative to the panel's top-left.
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Smallest the window may be resized to.
const MIN_W = 260;
const MIN_H = 140;

// Which edges a resize handle moves. A "move" drag (title bar) sets none of them.
interface Edges {
  l?: boolean;
  r?: boolean;
  t?: boolean;
  b?: boolean;
}

// An in-progress drag (move or resize): what edges, where the pointer started,
// and the window rect at drag start. Held in a ref so the window-level mouse
// listeners always read the latest without re-binding.
interface DragState {
  edges: Edges | null; // null = move (drag whole window)
  startX: number;
  startY: number;
  startRect: Rect;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// Per-group display model: ordered columns + one row of values per feature, plus
// the resolved link mapping (which column becomes a clickable cell vs. which
// links go in the trailing "Links" column).
interface GroupView {
  group: SelectedLayerGroup;
  titleHeader: string | null;
  keys: string[];
  // Each row keeps its full props so link URLs can reference any field, not just
  // the shown columns.
  rows: Array<{ title: string | null; byKey: Map<string, unknown>; props: Record<string, unknown> }>;
  // Column name -> link: a link whose URL references exactly one field that IS a
  // shown column; that column's value renders as the clickable link.
  cellLinks: Map<string, TooltipLink>;
  // Links that don't map to a single shown column — rendered in a "Links" column
  // as labeled links so nothing configured is lost.
  extraLinks: TooltipLink[];
}

// Build the table model for one layer group by running each feature's properties
// through the shared field filter and unioning the keys (so sparse rows align),
// then partitioning the layer's links into per-cell links vs. extra labeled links.
const buildGroupView = (group: SelectedLayerGroup): GroupView => {
  const keys: string[] = [];
  const seen = new Set<string>();
  let usesTitle = false;
  const rows = group.features.map((f) => {
    const { title, entries } = selectTooltipFields(f.props, group.filter);
    if (title !== null) {
      usesTitle = true;
    }
    for (const [k] of entries) {
      if (!seen.has(k)) {
        seen.add(k);
        keys.push(k);
      }
    }
    return { title, byKey: new Map(entries), props: f.props };
  });
  const titleHeader = usesTitle ? group.filter.titleField || 'title' : null;

  // The set of shown column names (the title field plus the attribute keys).
  const columns = new Set<string>(keys);
  if (titleHeader && group.filter.titleField) {
    columns.add(group.filter.titleField);
  }

  // Partition the layer's links: a link with exactly one ${field} placeholder
  // that matches a shown column becomes that column's cell link; the rest become
  // labeled links in a trailing column.
  const cellLinks = new Map<string, TooltipLink>();
  const extraLinks: TooltipLink[] = [];
  for (const link of group.links ?? []) {
    const fields = linkPlaceholderFields(link.url);
    if (fields.length === 1 && columns.has(fields[0]) && !cellLinks.has(fields[0])) {
      cellLinks.set(fields[0], link);
    } else {
      extraLinks.push(link);
    }
  }
  return { group, titleHeader, keys, rows, cellLinks, extraLinks };
};

export const SelectionResults: React.FC<Props> = ({ result, onClose, width, height, replaceVariables }) => {
  const styles = useStyles2(getStyles);

  // Render a table cell's value, as a link when a configured link maps to that
  // column (else plain text). The link text is the cell value (e.g. an
  // equipment id), and the URL is the layer's link filled from the row.
  const cellContent = (value: unknown, link: TooltipLink | undefined, props: Record<string, unknown>) => {
    if (!link) {
      return fmt(value);
    }
    const r = resolveLink(link, props, replaceVariables);
    if (!r) {
      return fmt(value);
    }
    return (
      <a
        className={styles.link}
        href={r.href}
        target={r.openInNewTab ? '_blank' : undefined}
        rel={r.openInNewTab ? 'noopener noreferrer' : undefined}
      >
        {fmt(value)}
      </a>
    );
  };

  // Initial window: a wide, half-height box docked near the bottom-left, but free
  // to be moved/resized from there. Computed once from the panel size.
  const [rect, setRect] = useState<Rect>(() => {
    const w = Math.min(width - 16, 560);
    const h = Math.min(Math.round(height * 0.5), 320);
    return { x: 8, y: Math.max(8, height - h - 8), w, h };
  });

  // Keep the window inside the panel as size/position change. Width/height first
  // (capped to the panel), then x/y so the window stays fully visible.
  const clampRect = (r: Rect): Rect => {
    const w = clamp(r.w, MIN_W, Math.max(MIN_W, width));
    const h = clamp(r.h, MIN_H, Math.max(MIN_H, height));
    return { w, h, x: clamp(r.x, 0, Math.max(0, width - w)), y: clamp(r.y, 0, Math.max(0, height - h)) };
  };

  // The rect actually shown is the stored rect clamped to the CURRENT panel size.
  // Deriving this during render (instead of via an effect that calls setState)
  // keeps the window on-screen when the panel is resized, with no extra renders.
  const displayRect = clampRect(rect);

  // Active drag, in a ref so the window listeners (bound once) read live values.
  const dragRef = useRef<DragState | null>(null);

  // Start a move (edges null) or resize (edges set). Records the start pointer +
  // the displayed rect; the window-level listeners below do the work. Defined as
  // a plain handler (not called during render) so it can safely write the ref.
  const beginDrag = (e: React.MouseEvent, edges: Edges | null) => {
    // Don't start a drag when the user clicked a button in the title bar.
    if ((e.target as HTMLElement).closest('button')) {
      return;
    }
    e.preventDefault();
    dragRef.current = { edges, startX: e.clientX, startY: e.clientY, startRect: displayRect };
  };

  // Bind move/up on the window ONCE so a drag that leaves the window still
  // tracks. Reads dragRef + the latest rect via the functional setRect.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) {
        return;
      }
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      const s = d.startRect;
      let { x, y, w, h } = s;
      if (!d.edges) {
        // Move the whole window.
        x = s.x + dx;
        y = s.y + dy;
      } else {
        // Resize: each active edge moves; left/top keep the opposite edge fixed
        // and respect the minimum size.
        if (d.edges.r) {
          w = Math.max(MIN_W, s.w + dx);
        }
        if (d.edges.b) {
          h = Math.max(MIN_H, s.h + dy);
        }
        if (d.edges.l) {
          w = Math.max(MIN_W, s.w - dx);
          x = s.x + (s.w - w);
        }
        if (d.edges.t) {
          h = Math.max(MIN_H, s.h - dy);
          y = s.y + (s.h - h);
        }
      }
      setRect(clampRect({ x, y, w, h }));
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height]);

  // Precompute the table models once per result.
  const views = useMemo(() => result.groups.map(buildGroupView), [result]);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const isOpen = (layerId: string) => expanded[layerId] !== false; // default open
  const toggle = (layerId: string) => setExpanded((prev) => ({ ...prev, [layerId]: !isOpen(layerId) }));

  // Copy BOTH a rich HTML table (email / rich chat → a real grid) and an aligned
  // plain-text table (monospace / Markdown targets → still readable). Falls back to
  // plain text where ClipboardItem isn't available.
  const onCopy = () => {
    const plain = selectionToPlainTable(result);
    const html = selectionToHtmlTable(result);
    try {
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        void navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([html], { type: 'text/html' }),
            'text/plain': new Blob([plain], { type: 'text/plain' }),
          }),
        ]);
        return;
      }
    } catch {
      // fall through to plain text
    }
    navigator.clipboard?.writeText(plain);
  };
  const onDownload = () => {
    const blob = new Blob([selectionToCsv(result)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'selection.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const empty = result.totalCount === 0;

  // The eight resize handles (edges + corners) with their cursors.
  const handles: Array<{ key: string; edges: Edges; cls: string }> = [
    { key: 'n', edges: { t: true }, cls: styles.hN },
    { key: 's', edges: { b: true }, cls: styles.hS },
    { key: 'e', edges: { r: true }, cls: styles.hE },
    { key: 'w', edges: { l: true }, cls: styles.hW },
    { key: 'ne', edges: { t: true, r: true }, cls: styles.hNE },
    { key: 'nw', edges: { t: true, l: true }, cls: styles.hNW },
    { key: 'se', edges: { b: true, r: true }, cls: styles.hSE },
    { key: 'sw', edges: { b: true, l: true }, cls: styles.hSW },
  ];

  return (
    <div
      className={styles.window}
      style={{ left: displayRect.x, top: displayRect.y, width: displayRect.w, height: displayRect.h }}
      data-testid="vectormap-selection-results"
    >
      {/* Title bar — drag here to move the window. */}
      <div className={styles.header} onMouseDown={(e) => beginDrag(e, null)}>
        <span className={styles.title}>{empty ? 'No features selected' : `Selection — ${result.totalCount}`}</span>
        <div className={styles.actions}>
          {!empty && (
            <>
              <Button size="sm" variant="secondary" icon="copy" onClick={onCopy} title="Copy as a formatted table (grid for email/chat, aligned text elsewhere)">
                Copy
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon="download-alt"
                onClick={onDownload}
                title="Download all rows as a CSV file"
              >
                CSV
              </Button>
            </>
          )}
          <IconButton name="times" aria-label="Close selection results" onClick={onClose} />
        </div>
      </div>

      {/* Scrollable body. */}
      <div className={styles.body}>
        <div className={styles.hint}>
          Shows features rendered at the current zoom and position inside the box. Zoom in for completeness.
          {result.cappedAny ? ' Large layers are capped — see "showing N of M".' : ''}
        </div>

        {!empty &&
          views.map((view) => {
            const g = view.group;
            const open = isOpen(g.layerId);
            const capped = g.totalBeforeCap > g.features.length;
            return (
              <div key={g.layerId} className={styles.group}>
                <button type="button" className={styles.groupHeader} onClick={() => toggle(g.layerId)}>
                  <Icon name={open ? 'angle-down' : 'angle-right'} />
                  <span className={styles.groupName}>{g.layerName}</span>
                  <span className={styles.count}>
                    {capped ? `showing ${g.features.length} of ${g.totalBeforeCap}` : g.features.length}
                  </span>
                </button>

                {open && (
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          {view.titleHeader && <th>{view.titleHeader}</th>}
                          {view.keys.map((k) => (
                            <th key={k}>{k}</th>
                          ))}
                          {view.extraLinks.length > 0 && <th>Links</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {view.rows.map((row, idx) => (
                          <tr key={idx}>
                            {view.titleHeader && (
                              <td>
                                {cellContent(
                                  row.title,
                                  g.filter.titleField ? view.cellLinks.get(g.filter.titleField) : undefined,
                                  row.props
                                )}
                              </td>
                            )}
                            {view.keys.map((k) => (
                              <td key={k}>{cellContent(row.byKey.get(k), view.cellLinks.get(k), row.props)}</td>
                            ))}
                            {view.extraLinks.length > 0 && (
                              <td>
                                <div className={styles.linkList}>
                                  {view.extraLinks.map((link, li) => {
                                    const r = resolveLink(link, row.props, replaceVariables);
                                    return r ? (
                                      <a
                                        key={li}
                                        className={styles.link}
                                        href={r.href}
                                        target={r.openInNewTab ? '_blank' : undefined}
                                        rel={r.openInNewTab ? 'noopener noreferrer' : undefined}
                                      >
                                        {r.label}
                                      </a>
                                    ) : null;
                                  })}
                                </div>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
      </div>

      {/* Resize handles (edges + corners). */}
      {handles.map((h) => (
        <div key={h.key} className={h.cls} onMouseDown={(e) => beginDrag(e, h.edges)} />
      ))}
    </div>
  );
};

// Render a cell value as text ('' for null/undefined).
const fmt = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

const getStyles = (theme: GrafanaTheme2) => {
  // Reusable bits for the (mostly invisible) resize handles.
  const edge = { position: 'absolute' as const, zIndex: 1 };
  const grip = 6; // edge thickness / corner size in px
  return {
    // Floating window over the map. zIndex 3 keeps it above the LayerControl (1)
    // and toolbar (1). A column layout: fixed title bar + scrolling body.
    window: css({
      position: 'absolute',
      zIndex: 3,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      background: theme.colors.background.primary,
      border: `1px solid ${theme.colors.border.medium}`,
      borderRadius: theme.shape.radius.default,
      boxShadow: theme.shadows.z3,
      fontSize: theme.typography.bodySmall.fontSize,
    }),
    header: css({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing(1),
      padding: theme.spacing(0.5, 1),
      background: theme.colors.background.secondary,
      borderBottom: `1px solid ${theme.colors.border.weak}`,
      cursor: 'move',
      userSelect: 'none',
    }),
    title: css({ fontWeight: theme.typography.fontWeightMedium }),
    actions: css({ display: 'flex', alignItems: 'center', gap: theme.spacing(1) }),
    body: css({ flex: 1, overflow: 'auto', padding: theme.spacing(1, 1.5) }),
    hint: css({
      color: theme.colors.text.secondary,
      fontSize: theme.typography.bodySmall.fontSize,
      marginBottom: theme.spacing(1),
    }),
    group: css({ marginBottom: theme.spacing(0.5) }),
    groupHeader: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(0.5),
      width: '100%',
      background: 'none',
      border: 'none',
      padding: theme.spacing(0.5, 0),
      color: theme.colors.text.primary,
      cursor: 'pointer',
      textAlign: 'left',
    }),
    groupName: css({ fontWeight: theme.typography.fontWeightMedium }),
    count: css({ color: theme.colors.text.secondary, marginLeft: 'auto' }),
    link: css({ color: theme.colors.text.link, textDecoration: 'underline', cursor: 'pointer' }),
    linkList: css({ display: 'flex', flexWrap: 'wrap', gap: theme.spacing(0, 1) }),
    tableWrap: css({
      overflow: 'auto',
      maxHeight: 240,
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: 2,
    }),
    table: css({
      borderCollapse: 'collapse',
      width: '100%',
      fontSize: theme.typography.bodySmall.fontSize,
      'th, td': { textAlign: 'left', padding: theme.spacing(0.5, 1), whiteSpace: 'nowrap', verticalAlign: 'top' },
      th: {
        position: 'sticky',
        top: 0,
        background: theme.colors.background.secondary,
        color: theme.colors.text.secondary,
        fontWeight: theme.typography.fontWeightMedium,
      },
      'tbody tr:nth-of-type(even)': { background: theme.colors.background.secondary },
    }),
    // Resize handles: thin strips on each edge and small squares in each corner.
    hN: css({ ...edge, top: 0, left: grip, right: grip, height: grip, cursor: 'ns-resize' }),
    hS: css({ ...edge, bottom: 0, left: grip, right: grip, height: grip, cursor: 'ns-resize' }),
    hE: css({ ...edge, top: grip, bottom: grip, right: 0, width: grip, cursor: 'ew-resize' }),
    hW: css({ ...edge, top: grip, bottom: grip, left: 0, width: grip, cursor: 'ew-resize' }),
    hNE: css({ ...edge, top: 0, right: 0, width: grip + 4, height: grip + 4, cursor: 'nesw-resize' }),
    hNW: css({ ...edge, top: 0, left: 0, width: grip + 4, height: grip + 4, cursor: 'nwse-resize' }),
    hSE: css({ ...edge, bottom: 0, right: 0, width: grip + 6, height: grip + 6, cursor: 'nwse-resize' }),
    hSW: css({ ...edge, bottom: 0, left: 0, width: grip + 4, height: grip + 4, cursor: 'nesw-resize' }),
  };
};
