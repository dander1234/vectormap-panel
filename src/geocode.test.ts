import { parseGeocodeResults } from './geocode';

describe('parseGeocodeResults', () => {
  it('parses a Nominatim-style array (lat/lon, display_name, boundingbox)', () => {
    const json = [
      {
        lat: '40.7128',
        lon: '-74.0060',
        display_name: 'New York, NY',
        boundingbox: ['40.4', '40.9', '-74.3', '-73.7'], // [south, north, west, east]
      },
    ];
    const [r] = parseGeocodeResults(json);
    expect(r.lat).toBeCloseTo(40.7128);
    expect(r.lng).toBeCloseTo(-74.006);
    expect(r.label).toBe('New York, NY');
    expect(r.bbox).toEqual([-74.3, 40.4, -73.7, 40.9]); // [west, south, east, north]
  });

  it('parses a GeoJSON FeatureCollection of points', () => {
    const json = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-74.006, 40.7128] },
          properties: { display_name: 'NYC' },
        },
      ],
    };
    const [r] = parseGeocodeResults(json);
    expect(r).toMatchObject({ lat: 40.7128, lng: -74.006, label: 'NYC' });
  });

  it('skips entries without finite coordinates and returns [] for junk', () => {
    expect(parseGeocodeResults([{ display_name: 'no coords' }])).toEqual([]);
    expect(parseGeocodeResults({ nope: true })).toEqual([]);
  });
});
