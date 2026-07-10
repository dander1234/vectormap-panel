// Unit tests for the pure selection helpers. These don't need a real map — for
// runSelectionQuery we pass a tiny fake `map` whose queryRenderedFeatures returns
// a controlled list of features.

import {
  selectTooltipFields,
  runSelectionQuery,
  buildSelectionResult,
  featureNearLine,
  highlightTargetFor,
  selectionToCsv,
  FieldFilterConfig,
  SelectionTarget,
  SelectionResult,
} from './selection';

const filter = (over: Partial<FieldFilterConfig> = {}): FieldFilterConfig => ({
  hideEmpty: true,
  include: '',
  exclude: '',
  titleField: '',
  ...over,
});

// A fake MapLibre map: queryRenderedFeatures returns the supplied features, and
// project maps a [lng,lat] coord to a pixel point (identity here, so test
// geometry is already in "pixel" space).
const fakeMap = (features: unknown[]): any => ({
  queryRenderedFeatures: () => features,
  project: (c: [number, number]) => ({ x: c[0], y: c[1] }),
});

describe('highlightTargetFor', () => {
  it('builds a target with sourceLayer for a vector-tile feature that has an id', () => {
    expect(highlightTargetFor({ id: 42, source: 'vt-abc', sourceLayer: 'fiber' })).toEqual({
      source: 'vt-abc',
      sourceLayer: 'fiber',
      id: 42,
    });
  });

  it('omits sourceLayer for a marker (GeoJSON) feature', () => {
    expect(highlightTargetFor({ id: 7, source: 'mk-xyz' })).toEqual({ source: 'mk-xyz', id: 7 });
  });

  // Regression: GeoServer/MVT tiles often omit per-feature ids. We must NOT throw
  // away the click (the caller still shows the tooltip) — we just can't highlight.
  it('returns null when the feature has no id (idless GeoServer tile)', () => {
    expect(highlightTargetFor({ source: 'vt-abc', sourceLayer: 'fiber' })).toBeNull();
    expect(highlightTargetFor({ id: undefined, source: 'vt-abc' })).toBeNull();
    expect(highlightTargetFor(undefined)).toBeNull();
    expect(highlightTargetFor(null)).toBeNull();
  });
});

describe('selectTooltipFields', () => {
  const props = { name: 'A', status: 'up', __color: '#fff', empty: '', note: 'hi' };

  it('drops internal __ keys, empties, and lifts the title field out', () => {
    const { title, entries } = selectTooltipFields(props, filter({ titleField: 'name' }));
    expect(title).toBe('A');
    expect(entries).toEqual([
      ['status', 'up'],
      ['note', 'hi'],
    ]); // __color (internal), empty (hideEmpty), name (title) all removed
  });

  it('keeps empties when hideEmpty is false', () => {
    const { entries } = selectTooltipFields(props, filter({ hideEmpty: false }));
    expect(entries.map(([k]) => k)).toEqual(['name', 'status', 'empty', 'note']);
  });

  it('applies include and exclude name regexes', () => {
    // include keeps only matching field NAMES
    expect(selectTooltipFields(props, filter({ include: '^note$' })).entries).toEqual([['note', 'hi']]);
    // exclude drops matching names; with no titleField, `name` stays
    expect(selectTooltipFields(props, filter({ exclude: 'status' })).entries).toEqual([
      ['name', 'A'],
      ['note', 'hi'],
    ]);
  });
});

describe('runSelectionQuery', () => {
  const target: SelectionTarget = {
    mapLayerId: 'vt-layer-a',
    layerId: 'a',
    layerName: 'Plant',
    isMarker: false,
    filter: filter(),
    links: [],
  };
  const box = { kind: 'box' as const, p1: [0, 0] as [number, number], p2: [10, 10] as [number, number] };

  it('dedupes the same feature returned once per covering tile', () => {
    const dup = { layer: { id: 'vt-layer-a' }, id: 5, source: 'vt-src-a', sourceLayer: 'plant', properties: { x: 1 } };
    const result = runSelectionQuery({
      map: fakeMap([dup, { ...dup }, { ...dup }]),
      geometry: box,
      targets: [target],
      maxPerLayer: 2000,
    });
    expect(result.totalCount).toBe(1);
    expect(result.groups[0].features).toHaveLength(1);
  });

  it('caps each layer at maxPerLayer and reports the pre-cap total', () => {
    const f1 = { layer: { id: 'vt-layer-a' }, id: 1, source: 'vt-src-a', sourceLayer: 'plant', properties: {} };
    const f2 = { layer: { id: 'vt-layer-a' }, id: 2, source: 'vt-src-a', sourceLayer: 'plant', properties: {} };
    const result = runSelectionQuery({ map: fakeMap([f1, f2]), geometry: box, targets: [target], maxPerLayer: 1 });
    expect(result.groups[0].features).toHaveLength(1);
    expect(result.groups[0].totalBeforeCap).toBe(2);
    expect(result.cappedAny).toBe(true);
  });

  it('returns empty when there are no targets', () => {
    const result = runSelectionQuery({ map: fakeMap([]), geometry: box, targets: [], maxPerLayer: 10 });
    expect(result).toEqual({ groups: [], totalCount: 0, cappedAny: false });
  });

  it('groups features by their originating layer', () => {
    const b: SelectionTarget = { ...target, mapLayerId: 'mk-layer-b', layerId: 'b', layerName: 'ONTs', isMarker: true };
    const fa = { layer: { id: 'vt-layer-a' }, id: 1, source: 's', sourceLayer: 'plant', properties: {} };
    const fb = { layer: { id: 'mk-layer-b' }, id: 2, source: 's', properties: {} };
    const result = runSelectionQuery({
      map: fakeMap([fa, fb]),
      geometry: box,
      targets: [target, b],
      maxPerLayer: 10,
    });
    expect(result.groups.map((g) => g.layerName)).toEqual(['Plant', 'ONTs']);
    expect(result.totalCount).toBe(2);
  });
});

describe('featureNearLine', () => {
  const id = (c: [number, number]): [number, number] => c; // identity projection
  const line: Array<[number, number]> = [[0, 0], [10, 0]]; // horizontal line y=0

  it('matches a point within the buffer, not one outside it', () => {
    expect(featureNearLine({ type: 'Point', coordinates: [5, 3] }, line, id, 6)).toBe(true);
    expect(featureNearLine({ type: 'Point', coordinates: [5, 9] }, line, id, 6)).toBe(false);
  });

  it('matches a line that crosses the drawn line', () => {
    // a vertical segment crossing y=0 at x=5
    expect(featureNearLine({ type: 'LineString', coordinates: [[5, -5], [5, 5]] }, line, id, 1)).toBe(true);
    // a parallel line far away
    expect(featureNearLine({ type: 'LineString', coordinates: [[0, 20], [10, 20]] }, line, id, 1)).toBe(false);
  });
});

describe('buildSelectionResult', () => {
  const target: SelectionTarget = {
    mapLayerId: 'vt-layer-a',
    layerId: 'a',
    layerName: 'Plant',
    isMarker: false,
    filter: filter(),
    links: [],
  };

  it('groups + dedupes an accumulated feature list (the click-select path)', () => {
    const f1 = { layer: { id: 'vt-layer-a' }, id: 1, source: 's', sourceLayer: 'plant', properties: {} };
    const f2 = { layer: { id: 'vt-layer-a' }, id: 2, source: 's', sourceLayer: 'plant', properties: {} };
    const result = buildSelectionResult([f1, f2, { ...f1 }], [target], 10);
    expect(result.totalCount).toBe(2);
    expect(result.groups[0].features).toHaveLength(2);
  });
});

describe('runSelectionQuery — lasso (polygon)', () => {
  const target: SelectionTarget = {
    mapLayerId: 'vt-layer-a',
    layerId: 'a',
    layerName: 'Plant',
    isMarker: false,
    filter: filter(),
    links: [],
  };
  // A 10x10 square lasso at the origin.
  const lasso = {
    kind: 'polygon' as const,
    points: [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ] as Array<[number, number]>,
  };
  const feat = (id: number, geometry: unknown) => ({
    layer: { id: 'vt-layer-a' },
    id,
    source: 's',
    sourceLayer: 'plant',
    properties: { n: id },
    geometry,
  });

  it('keeps points inside the lasso and drops points outside', () => {
    const inside = feat(1, { type: 'Point', coordinates: [5, 5] });
    const outside = feat(2, { type: 'Point', coordinates: [50, 50] });
    const result = runSelectionQuery({
      map: fakeMap([inside, outside]),
      geometry: lasso,
      targets: [target],
      maxPerLayer: 10,
    });
    expect(result.totalCount).toBe(1);
    expect(result.groups[0].features[0].props.n).toBe(1);
  });

  it('selects a line that crosses the lasso even with no vertex inside (plant segment)', () => {
    const crossing = feat(3, {
      type: 'LineString',
      coordinates: [
        [-5, 5],
        [50, 5],
      ],
    });
    const result = runSelectionQuery({
      map: fakeMap([crossing]),
      geometry: lasso,
      targets: [target],
      maxPerLayer: 10,
    });
    expect(result.totalCount).toBe(1);
  });

  it('returns empty for a degenerate (<3 point) polygon', () => {
    const result = runSelectionQuery({
      map: fakeMap([feat(1, { type: 'Point', coordinates: [5, 5] })]),
      geometry: { kind: 'polygon', points: [[0, 0], [1, 1]] as Array<[number, number]> },
      targets: [target],
      maxPerLayer: 10,
    });
    expect(result.totalCount).toBe(0);
  });
});

describe('selectionToCsv', () => {
  const result: SelectionResult = {
    totalCount: 2,
    cappedAny: false,
    groups: [
      {
        layerId: 'a',
        layerName: 'Plant',
        isMarker: false,
        filter: filter({ titleField: 'name' }),
        links: [],
        totalBeforeCap: 2,
        features: [
          { dedupeKey: '1', source: 's', props: { name: 'A, Inc', status: 'up' } },
          { dedupeKey: '2', source: 's', props: { name: 'B "Best"', note: 'x\ny' } },
        ],
      },
    ],
  };

  it('emits a per-layer section with title-first columns and RFC4180 quoting', () => {
    const csv = selectionToCsv(result);
    expect(csv).toContain('# Plant (2)');
    // title column ("name") comes first, then unioned keys (status, note)
    expect(csv).toContain('name,status,note');
    // commas, quotes, and newlines are quoted/escaped
    expect(csv).toContain('"A, Inc"');
    expect(csv).toContain('"B ""Best"""');
    expect(csv).toContain('"x\ny"');
  });
});
