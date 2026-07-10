import { groupCheckState, orderByKey } from './layerControl';

describe('orderByKey', () => {
  const id = (s: string) => s;
  it('puts listed keys first (in order), then unlisted in original order', () => {
    expect(orderByKey(['a', 'b', 'c', 'd'], id, ['c', 'a'])).toEqual(['c', 'a', 'b', 'd']);
  });
  it('ignores stale keys that match no item', () => {
    expect(orderByKey(['a', 'b'], id, ['x', 'b', 'y'])).toEqual(['b', 'a']);
  });
  it('is identity for empty order', () => {
    expect(orderByKey(['a', 'b', 'c'], id, [])).toEqual(['a', 'b', 'c']);
  });
  it('works on objects via a key function', () => {
    const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(orderByKey(list, (o) => o.id, ['b']).map((o) => o.id)).toEqual(['b', 'a', 'c']);
  });
});

describe('groupCheckState', () => {
  it('is "on" when every layer is visible (default = visible)', () => {
    // Missing keys default to visible (the `!== false` convention).
    expect(groupCheckState(['a', 'b'], {})).toBe('on');
    expect(groupCheckState(['a', 'b'], { a: true, b: true })).toBe('on');
  });

  it('is "off" when no layer is visible', () => {
    expect(groupCheckState(['a', 'b'], { a: false, b: false })).toBe('off');
  });

  it('is "mixed" when some are visible and some hidden', () => {
    expect(groupCheckState(['a', 'b'], { a: true, b: false })).toBe('mixed');
    expect(groupCheckState(['a', 'b', 'c'], { b: false })).toBe('mixed');
  });

  it('treats an empty group as "off"', () => {
    expect(groupCheckState([], {})).toBe('off');
  });
});
