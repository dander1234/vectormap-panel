import { haversineMeters, pathLengthMeters, formatDistanceBoth } from './measure';

describe('haversineMeters', () => {
  it('is 0 for the same point', () => {
    expect(haversineMeters([-122, 37], [-122, 37])).toBe(0);
  });
  it('~111.2 km per degree of latitude at the equator', () => {
    const d = haversineMeters([0, 0], [0, 1]);
    expect(d).toBeGreaterThan(110000);
    expect(d).toBeLessThan(112000);
  });
  it('is symmetric', () => {
    const a: [number, number] = [-122.4, 37.7];
    const b: [number, number] = [-122.3, 37.8];
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 6);
  });
});

describe('pathLengthMeters', () => {
  it('is 0 for fewer than two points', () => {
    expect(pathLengthMeters([])).toBe(0);
    expect(pathLengthMeters([[0, 0]])).toBe(0);
  });
  it('sums consecutive segments', () => {
    const pts: Array<[number, number]> = [[0, 0], [0, 1], [0, 2]];
    expect(pathLengthMeters(pts)).toBeCloseTo(2 * haversineMeters([0, 0], [0, 1]), 3);
  });
});

describe('formatDistanceBoth', () => {
  it('shows feet + meters for short distances, with thousands separators', () => {
    // 378 m ≈ 1240 ft
    expect(formatDistanceBoth(378)).toBe('1,240 ft (378 m)');
  });
  it('switches to miles + km past the thresholds', () => {
    const s = formatDistanceBoth(4360); // ≈ 2.71 mi, 4.36 km
    expect(s).toMatch(/mi/);
    expect(s).toMatch(/km\)$/);
  });
  it('is 0 ft (0 m) at zero', () => {
    expect(formatDistanceBoth(0)).toBe('0 ft (0 m)');
  });
});
