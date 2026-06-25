// SearchBox — the address search box shown over the map.
//
// Local-first: as the user types we show matching query-data rows (instant,
// in-memory). The external geocoder is only called on demand — pressing Enter or
// the "Search web" button — to respect provider rate limits. Picking any result
// is reported to the panel, which flies there, drops a pin, and opens a popup.

import React, { useEffect, useRef, useState } from 'react';
import { GrafanaTheme2 } from '@grafana/data';
import { Icon, IconButton, Spinner, useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';
import { SearchHit } from '../search';
import { GeocodeResult } from '../geocode';

interface Props {
  // Instant in-memory search over the query data (returns local hits).
  localSearch: (query: string) => SearchHit[];
  // On-demand external geocode (the panel wires this to the configured provider).
  webSearch: (query: string, signal: AbortSignal) => Promise<GeocodeResult[]>;
  // Whether an external geocoder is configured (controls the "Search web" action).
  geocoderEnabled: boolean;
  // User picked a result — fly/pin/popup is the panel's job.
  onPick: (hit: SearchHit) => void;
  // User cleared the box — remove the result pin/popup (panel's job).
  onClear: () => void;
}

export const SearchBox: React.FC<Props> = ({ localSearch, webSearch, geocoderEnabled, onPick, onClear }) => {
  const styles = useStyles2(getStyles);
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(false);
  const [localHits, setLocalHits] = useState<SearchHit[]>([]);
  const [webHits, setWebHits] = useState<GeocodeResult[] | null>(null); // null = not searched yet
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Debounced local search as the user types (instant, no network). Only the
  // async setState (inside the timer) lives here; the synchronous invalidation of
  // prior web results happens in onChangeValue below.
  useEffect(() => {
    const t = setTimeout(() => setLocalHits(value.trim() ? localSearch(value) : []), 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Typing a new query invalidates any prior web results/error.
  const onChangeValue = (v: string) => {
    setValue(v);
    setWebHits(null);
    setError(null);
  };

  // Cancel any in-flight web request on unmount.
  useEffect(() => () => abortRef.current?.abort(), []);

  const doWeb = () => {
    if (!geocoderEnabled || !value.trim()) {
      return;
    }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError(null);
    webSearch(value, ctrl.signal)
      .then((results) => {
        if (!ctrl.signal.aborted) {
          setWebHits(results);
        }
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) {
          setError(e?.message || 'Search failed');
          setWebHits([]);
        }
      })
      .finally(() => {
        if (!ctrl.signal.aborted) {
          setLoading(false);
        }
      });
  };

  const pick = (hit: SearchHit) => {
    onPick(hit);
    setOpen(false);
  };

  const clear = () => {
    setValue('');
    setLocalHits([]);
    setWebHits(null);
    setError(null);
    abortRef.current?.abort();
    onClear();
  };

  const showDropdown = open && value.trim().length > 0;

  return (
    <div className={styles.wrap}>
      <div className={styles.inputRow}>
        <Icon name="search" className={styles.searchIcon} />
        <input
          className={styles.input}
          value={value}
          placeholder="Search address…"
          onChange={(e) => onChangeValue(e.currentTarget.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)} // delay so row clicks register
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              doWeb();
            } else if (e.key === 'Escape') {
              clear();
            }
          }}
        />
        {loading && <Spinner size="sm" />}
        {value && <IconButton name="times" aria-label="Clear search" onClick={clear} />}
      </div>

      {showDropdown && (
        <div className={styles.dropdown}>
          {localHits.length > 0 && (
            <div className={styles.section}>
              <div className={styles.sectionLabel}>From data</div>
              {localHits.map((hit, idx) => (
                <button type="button" key={`l-${idx}`} className={styles.row} onMouseDown={() => pick(hit)}>
                  <Icon name="map-marker" className={styles.rowIcon} />
                  <span className={styles.rowMain}>{hit.label}</span>
                  <span className={styles.rowMeta}>{hit.source === 'local' ? hit.layerName : ''}</span>
                </button>
              ))}
            </div>
          )}

          {geocoderEnabled && (
            <div className={styles.section}>
              <div className={styles.sectionLabel}>
                Web {webHits === null && <button type="button" className={styles.webBtn} onMouseDown={doWeb}>Search web ↵</button>}
              </div>
              {error && <div className={styles.note}>{error}</div>}
              {webHits !== null && webHits.length === 0 && !error && <div className={styles.note}>No web results</div>}
              {(webHits ?? []).map((r, idx) => (
                <button
                  type="button"
                  key={`w-${idx}`}
                  className={styles.row}
                  onMouseDown={() => pick({ source: 'web', label: r.label, lng: r.lng, lat: r.lat, bbox: r.bbox })}
                >
                  <Icon name="globe" className={styles.rowIcon} />
                  <span className={styles.rowMain}>{r.label}</span>
                </button>
              ))}
            </div>
          )}

          {localHits.length === 0 && !geocoderEnabled && <div className={styles.note}>No matches in data</div>}
        </div>
      )}
    </div>
  );
};

const getStyles = (theme: GrafanaTheme2) => ({
  wrap: css({
    position: 'absolute',
    top: theme.spacing(1),
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 2,
    width: 'min(360px, 70%)',
  }),
  inputRow: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    background: theme.colors.background.primary,
    border: `1px solid ${theme.colors.border.medium}`,
    borderRadius: theme.shape.radius.default,
    padding: theme.spacing(0.5, 1),
    boxShadow: theme.shadows.z1,
  }),
  searchIcon: css({ color: theme.colors.text.secondary }),
  input: css({
    flex: 1,
    border: 'none',
    outline: 'none',
    background: 'transparent',
    color: theme.colors.text.primary,
    fontSize: theme.typography.body.fontSize,
  }),
  dropdown: css({
    marginTop: theme.spacing(0.5),
    background: theme.colors.background.primary,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    boxShadow: theme.shadows.z2,
    overflow: 'hidden',
    maxHeight: 320,
    overflowY: 'auto',
  }),
  section: css({ padding: theme.spacing(0.5, 0) }),
  sectionLabel: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: theme.spacing(0.25, 1),
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
  }),
  webBtn: css({
    border: 'none',
    background: 'none',
    color: theme.colors.text.link,
    cursor: 'pointer',
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  row: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    width: '100%',
    border: 'none',
    background: 'none',
    padding: theme.spacing(0.5, 1),
    color: theme.colors.text.primary,
    cursor: 'pointer',
    textAlign: 'left',
    '&:hover': { background: theme.colors.action.hover },
  }),
  rowIcon: css({ color: theme.colors.text.secondary, flexShrink: 0 }),
  rowMain: css({ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }),
  rowMeta: css({ color: theme.colors.text.secondary, fontSize: theme.typography.bodySmall.fontSize }),
  note: css({ padding: theme.spacing(0.5, 1), color: theme.colors.text.secondary, fontSize: theme.typography.bodySmall.fontSize }),
});
