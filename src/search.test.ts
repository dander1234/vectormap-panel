import { DataFrame } from '@grafana/data';
import { localAddressSearch } from './search';
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
    lat: [40.1, 40.2, 40.3],
    lng: [-74.1, -74.2, -74.3],
  }),
];

describe('localAddressSearch', () => {
  it('matches rows whose address field contains the query (case-insensitive)', () => {
    const hits = localAddressSearch([layer({})], series, 'main', 8);
    expect(hits.map((h) => h.label)).toEqual(['123 Main St', '789 Main Blvd']);
    const first = hits[0];
    expect(first.source).toBe('local');
    if (first.source === 'local') {
      expect(first).toMatchObject({ layerName: 'ONTs', lat: 40.1, lng: -74.1 });
      expect(first.props.address).toBe('123 Main St');
    }
  });

  it('excludes layers without an address field', () => {
    expect(localAddressSearch([layer({ addressField: '' })], series, 'main', 8)).toEqual([]);
  });

  it('respects the bound refId', () => {
    expect(localAddressSearch([layer({ refId: 'B' })], series, 'main', 8)).toEqual([]);
  });

  it('caps results at max', () => {
    expect(localAddressSearch([layer({})], series, 'main', 1)).toHaveLength(1);
  });

  it('returns [] for a blank query', () => {
    expect(localAddressSearch([layer({})], series, '   ', 8)).toEqual([]);
  });
});
