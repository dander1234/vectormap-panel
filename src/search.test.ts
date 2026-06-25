import { DataFrame } from '@grafana/data';
import { localFeatureSearch } from './search';
import { createDefaultMarkerLayer, MarkerLayerConfig } from './types';

// Minimal DataFrame factory for tests (localAddressSearch only reads refId,
// length, fields[].name and fields[].values).
const frame = (refId: string, cols: Record<string, unknown[]>): DataFrame => {
  const names = Object.keys(cols);
  const length = names.length ? cols[names[0]].length : 0;
  return {
    refId,
    length,
    fields: names.map((name) => ({ name, values: cols[name] })),
  } as unknown as DataFrame;
};

const layer = (over: Partial<MarkerLayerConfig>): MarkerLayerConfig => ({
  ...createDefaultMarkerLayer(),
  name: 'ONTs',
  refId: 'A',
  addressField: 'address',
  latField: 'lat',
  lngField: 'lng',
  ...over,
});

const series = [
  frame('A', {
    address: ['123 Main St', '456 Oak Ave', '789 Main Blvd'],
    account: [100200, 100300, 100400],
    equipment: [55501, 55502, 55503],
    lat: [40.1, 40.2, 40.3],
    lng: [-74.1, -74.2, -74.3],
  }),
];

describe('localFeatureSearch', () => {
  it('matches rows whose address field contains the query (case-insensitive)', () => {
    const hits = localFeatureSearch([layer({})], series, 'main', 8);
    expect(hits.map((h) => h.label)).toEqual(['123 Main St', '789 Main Blvd']);
    const first = hits[0];
    expect(first.source).toBe('local');
    if (first.source === 'local') {
      expect(first).toMatchObject({ layerName: 'ONTs', kind: 'address', lat: 40.1, lng: -74.1 });
      expect(first.props.address).toBe('123 Main St');
    }
  });

  it('matches the account ID field and tags the hit kind', () => {
    const hits = localFeatureSearch([layer({ accountIdField: 'account' })], series, '100300', 8);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ source: 'local', kind: 'account', label: '100300', lat: 40.2 });
  });

  it('matches the equipment ID field', () => {
    const hits = localFeatureSearch([layer({ equipmentIdField: 'equipment' })], series, '55503', 8);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ kind: 'equipment', label: '55503', lat: 40.3 });
  });

  it('searches address + account + equipment together; first matching field per row wins', () => {
    const hits = localFeatureSearch(
      [layer({ accountIdField: 'account', equipmentIdField: 'equipment' })],
      series,
      '5550',
      8
    );
    // All three rows' equipment ids contain "5550"; addresses/accounts don't.
    expect(hits.map((h) => h.source === 'local' && h.kind)).toEqual(['equipment', 'equipment', 'equipment']);
  });

  it('excludes layers with no searchable fields set', () => {
    expect(localFeatureSearch([layer({ addressField: '' })], series, 'main', 8)).toEqual([]);
  });

  it('respects the bound refId', () => {
    expect(localFeatureSearch([layer({ refId: 'B' })], series, 'main', 8)).toEqual([]);
  });

  it('caps results at max', () => {
    expect(localFeatureSearch([layer({ accountIdField: 'account' })], series, '1003', 1)).toHaveLength(1);
  });

  it('returns [] for a blank query', () => {
    expect(localFeatureSearch([layer({})], series, '   ', 8)).toEqual([]);
  });
});
