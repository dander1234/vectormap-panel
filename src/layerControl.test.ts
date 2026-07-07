import { groupCheckState } from './layerControl';

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
