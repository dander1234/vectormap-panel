import { sanitizeUrl, fillUrl, linkPlaceholderFields, resolveLink } from './links';

const id = (s: string) => s; // identity replaceVariables

describe('linkPlaceholderFields', () => {
  it('extracts unique ${field} placeholders', () => {
    expect(linkPlaceholderFields('https://x/equip/${equipment_id}')).toEqual(['equipment_id']);
    expect(linkPlaceholderFields('https://x/${a}?b=${b}&a2=${a}')).toEqual(['a', 'b']);
    expect(linkPlaceholderFields('https://x/static')).toEqual([]);
  });
});

describe('sanitizeUrl', () => {
  it('allows http(s) and rejects dangerous schemes', () => {
    expect(sanitizeUrl('https://ok.example')).toBe('https://ok.example');
    expect(sanitizeUrl('  javascript:alert(1)')).toBeNull();
    expect(sanitizeUrl('')).toBeNull();
  });
});

describe('fillUrl', () => {
  it('substitutes ${field} (URL-encoded) from props, then runs replaceVariables', () => {
    const url = fillUrl('https://x/equip/${equipment_id}', { equipment_id: '55 5/03' }, id);
    expect(url).toBe('https://x/equip/55%205%2F03');
  });
  it('leaves unknown placeholders for replaceVariables to handle', () => {
    const rv = (s: string) => s.replace('${region}', 'west');
    expect(fillUrl('https://x/${region}/${acct}', { acct: '12' }, rv)).toBe('https://x/west/12');
  });
});

describe('resolveLink', () => {
  it('returns href/label/openInNewTab, or null when unsafe', () => {
    const link = { label: 'Equip', url: 'https://x/${equipment_id}', openInNewTab: true };
    expect(resolveLink(link, { equipment_id: '900' }, id)).toEqual({
      href: 'https://x/900',
      label: 'Equip',
      openInNewTab: true,
    });
    expect(resolveLink({ label: '', url: 'javascript:x', openInNewTab: false }, {}, id)).toBeNull();
  });
});
