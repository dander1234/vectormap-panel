import { MARKER_ICONS, iconById, searchIcons } from './icons';

describe('marker icon registry', () => {
  it('has unique ids and a non-empty path for every icon', () => {
    const ids = new Set<string>();
    for (const icon of MARKER_ICONS) {
      expect(icon.id).toBeTruthy();
      expect(ids.has(icon.id)).toBe(false);
      ids.add(icon.id);
      expect(icon.path.trim().length).toBeGreaterThan(0);
      expect(icon.name.trim().length).toBeGreaterThan(0);
    }
  });

  it('keeps the 7 original geometric ids (back-compat with saved panels)', () => {
    for (const id of ['circle', 'square', 'triangle', 'diamond', 'star', 'cross', 'hexagon']) {
      expect(iconById(id)).toBeDefined();
    }
  });

  it('includes telecom icons', () => {
    for (const id of ['handhole', 'vault', 'ont', 'cabinet', 'splice', 'pole', 'node']) {
      expect(iconById(id)?.category).toBe('telecom');
    }
  });
});

describe('iconById', () => {
  it('returns the icon or undefined', () => {
    expect(iconById('vault')?.name).toBe('Vault');
    expect(iconById('does-not-exist')).toBeUndefined();
  });
});

describe('searchIcons', () => {
  it('returns the whole suite for a blank query', () => {
    expect(searchIcons('')).toHaveLength(MARKER_ICONS.length);
    expect(searchIcons('   ')).toHaveLength(MARKER_ICONS.length);
  });

  it('matches by name (case-insensitive)', () => {
    expect(searchIcons('VAULT').map((i) => i.id)).toContain('vault');
  });

  it('matches by keyword', () => {
    // 'ont' keyword 'modem'; 'cabinet' keyword 'fdh'
    expect(searchIcons('modem').map((i) => i.id)).toContain('ont');
    expect(searchIcons('fdh').map((i) => i.id)).toContain('cabinet');
  });

  it('returns empty for no match', () => {
    expect(searchIcons('zzznope')).toEqual([]);
  });
});
