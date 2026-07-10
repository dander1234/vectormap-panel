// icons.ts — the marker icon registry.
//
// ONE source of truth for both the map (rasterized to a recolorable SDF image in
// shapeIcons.ts) and the on-map legend (rendered as an <svg> in LayerControl).
//
// Every icon is a MONOCHROME silhouette: a single SVG `path` authored in a 24×24
// viewBox. Monochrome is required because the map recolors icons per feature via
// MapLibre's `icon-color` (color-by-data / status / highlight) — a multi-color
// image could not be recolored. Holes (e.g. the ring in a map pin) are cut with
// `fillRule: 'evenodd'`.
//
// `id` is what gets stored in a marker layer's `shape`. The 7 original geometric
// ids are kept verbatim so panels saved before this suite existed still resolve.

export type IconCategory = 'geometric' | 'general' | 'telecom';

export interface MarkerIcon {
  id: string;
  name: string;
  category: IconCategory;
  keywords: string[];
  path: string; // SVG path data in a 0 0 24 24 viewBox
  fillRule?: 'nonzero' | 'evenodd'; // 'evenodd' for icons with holes
}

export const MARKER_ICONS: MarkerIcon[] = [
  // --- Geometric (original 7 — ids unchanged for back-compat) ----------------
  { id: 'circle', name: 'Circle', category: 'geometric', keywords: ['dot', 'point', 'round'],
    path: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z' },
  { id: 'square', name: 'Square', category: 'geometric', keywords: ['box', 'rect'],
    path: 'M5 5h14v14H5z' },
  { id: 'triangle', name: 'Triangle', category: 'geometric', keywords: ['delta', 'up'],
    path: 'M12 4 21 20H3z' },
  { id: 'diamond', name: 'Diamond', category: 'geometric', keywords: ['rhombus'],
    path: 'M12 3 21 12 12 21 3 12z' },
  { id: 'star', name: 'Star', category: 'geometric', keywords: ['favorite'],
    path: 'M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z' },
  { id: 'cross', name: 'Plus', category: 'geometric', keywords: ['plus', 'add'],
    path: 'M9 4h6v5h5v6h-5v5H9v-5H4V9h5z' },
  { id: 'hexagon', name: 'Hexagon', category: 'geometric', keywords: ['hex'],
    path: 'M12 3 19.8 7.5 19.8 16.5 12 21 4.2 16.5 4.2 7.5z' },

  // --- General ---------------------------------------------------------------
  { id: 'pin', name: 'Map pin', category: 'general', keywords: ['marker', 'location', 'place'], fillRule: 'evenodd',
    path: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 0 1 0-5 2.5 2.5 0 0 1 0 5z' },
  { id: 'teardrop', name: 'Teardrop', category: 'general', keywords: ['pin', 'marker', 'drop'],
    path: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z' },
  { id: 'dot', name: 'Dot', category: 'general', keywords: ['small', 'point'],
    path: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z' },
  { id: 'ring', name: 'Ring', category: 'general', keywords: ['donut', 'hollow', 'circle'], fillRule: 'evenodd',
    path: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm0 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8z' },
  { id: 'flag', name: 'Flag', category: 'general', keywords: ['mark', 'pennant'],
    path: 'M6 3h1.8v18H6z M7.8 4h10l-2.6 3.6 2.6 3.6H7.8z' },
  { id: 'tag', name: 'Tag', category: 'general', keywords: ['label'], fillRule: 'evenodd',
    path: 'M20.6 11.4 12.6 3.4C12.2 3 11.7 3 11 3H5C3.9 3 3 3.9 3 5v6c0 .5.2 1 .6 1.4l8 8c.4.4.9.6 1.4.6s1-.2 1.4-.6l5.2-5.2c.4-.4.6-.9.6-1.4s-.2-1-.6-1.4zM6.5 8A1.5 1.5 0 1 1 8 6.5 1.5 1.5 0 0 1 6.5 8z' },
  { id: 'house', name: 'House', category: 'general', keywords: ['home', 'building', 'premises'],
    path: 'M12 3 3 11h2.5v9H10v-5h4v5h4.5v-9H21z' },
  { id: 'wrench', name: 'Wrench', category: 'general', keywords: ['maintenance', 'repair', 'tool', 'build'],
    path: 'M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z' },
  { id: 'bolt', name: 'Bolt', category: 'general', keywords: ['power', 'lightning', 'energized'],
    path: 'M7 2v11h3v9l7-12h-4l4-8z' },
  { id: 'warning', name: 'Warning', category: 'general', keywords: ['alert', 'fault', 'caution'], fillRule: 'evenodd',
    path: 'M1 21h22L12 2zm12-3h-2v-2h2zm0-4h-2v-4h2z' },
  { id: 'check', name: 'Check', category: 'general', keywords: ['ok', 'done', 'active', 'up'],
    path: 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z' },
  { id: 'x-mark', name: 'X mark', category: 'general', keywords: ['close', 'down', 'fault', 'cancel'],
    path: 'M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z' },

  // --- Telecom / fiber -------------------------------------------------------
  { id: 'handhole', name: 'Handhole', category: 'telecom', keywords: ['hh', 'access', 'lid', 'pit', 'pull box'], fillRule: 'evenodd',
    path: 'M4 7h16a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1zm2 4h12v2H6z' },
  { id: 'vault', name: 'Vault', category: 'telecom', keywords: ['handhole', 'access', 'underground', 'chamber'], fillRule: 'evenodd',
    path: 'M3 7h18v10H3zm3 2h4v6H6zm8 0h4v6h-4z' },
  { id: 'manhole', name: 'Manhole', category: 'telecom', keywords: ['cover', 'access', 'round', 'vault'], fillRule: 'evenodd',
    path: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm-5 7h10v1.5H7zm0 3h10v1.5H7z' },
  { id: 'ont', name: 'ONT', category: 'telecom', keywords: ['modem', 'onu', 'cpe', 'terminal', 'subscriber'], fillRule: 'evenodd',
    path: 'M4 8h16a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1zm2.5 3.5h1.5V13H6.5zm3 0H11V13H9.5zm3 0H14V13h-1.5z' },
  { id: 'cabinet', name: 'Cabinet', category: 'telecom', keywords: ['fdh', 'cross-connect', 'flexnap', 'enclosure', 'rack'], fillRule: 'evenodd',
    path: 'M6 3h12v18H6zm5.5 3h1v12h-1zM8 5.5h2.5v1H8zm5.5 0H16v1h-2.5z' },
  { id: 'pedestal', name: 'Pedestal', category: 'telecom', keywords: ['ped', 'closure', 'above ground', 'dome'],
    path: 'M8 9a4 4 0 0 1 8 0v8H8z M6 17h12v3H6z' },
  { id: 'splice', name: 'Splice closure', category: 'telecom', keywords: ['splice', 'case', 'closure', 'dome', 'inline'], fillRule: 'evenodd',
    path: 'M7 8h10a4 4 0 0 1 0 8H7a4 4 0 0 1 0-8zm4.5.5h1v7h-1z' },
  { id: 'pole', name: 'Pole', category: 'telecom', keywords: ['utility', 'aerial', 'strand', 'crossarm'],
    path: 'M11 3h2v18h-2z M6 7h12v1.8H6z' },
  { id: 'tower', name: 'Tower', category: 'telecom', keywords: ['cell', 'mast', 'transmission', 'lattice'], fillRule: 'evenodd',
    path: 'M12 2 5 21h14zm0 5 3.5 11h-7z' },
  { id: 'node', name: 'Network node', category: 'telecom', keywords: ['hub', 'olt', 'headend', 'core'], fillRule: 'evenodd',
    path: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 4a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4z' },
  { id: 'splitter', name: 'Splitter', category: 'telecom', keywords: ['split', 'passive', 'plc', 'fan-out', 'distribution'],
    path: 'M3 8h6v8H3z M9 10.5h5v1H9z M9 13h7v1H9z M9 15.5h5v1H9z' },
  { id: 'amplifier', name: 'Amplifier', category: 'telecom', keywords: ['amp', 'gain', 'rf', 'active'], fillRule: 'evenodd',
    path: 'M4 6h16v12H4zm5 3v6l5-3z' },
  { id: 'meter', name: 'Meter', category: 'telecom', keywords: ['gauge', 'test point', 'measure', 'otdr'], fillRule: 'evenodd',
    path: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm-.6 9 3-3.5.9.7-2.4 3.5z' },
  { id: 'nid', name: 'NID / terminal', category: 'telecom', keywords: ['nid', 'terminal', 'demarc', 'network interface', 'box'], fillRule: 'evenodd',
    path: 'M5 6h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zm10 5h3v2h-3z' },
  { id: 'junction', name: 'Junction box', category: 'telecom', keywords: ['junction', 'jbox', 'tap', 'connection'], fillRule: 'evenodd',
    path: 'M4 4h16v16H4zm7 4h2v3h3v2h-3v3h-2v-3H8v-2h3z' },
  { id: 'building', name: 'Central office', category: 'telecom', keywords: ['co', 'pop', 'headend', 'exchange', 'building'], fillRule: 'evenodd',
    path: 'M5 4h14v16H5zm3 3h2v2H8zm6 0h2v2h-2zm-6 4h2v2H8zm6 0h2v2h-2zm-3.5 5h3v4h-3z' },
  { id: 'repeater', name: 'Repeater', category: 'telecom', keywords: ['regenerator', 'boost', 'signal', 'chevron'],
    path: 'M4 7 12 12 4 17z M12 7 20 12 12 17z' },
  { id: 'antenna', name: 'Antenna', category: 'telecom', keywords: ['signal', 'wireless', 'broadcast', 'aerial'],
    path: 'M12 3 8 9h8z M11 9h2v12h-2z' },
];

// Fast id lookup (built once).
const BY_ID = new Map(MARKER_ICONS.map((i) => [i.id, i]));
export const iconById = (id: string): MarkerIcon | undefined => BY_ID.get(id);

// Search by name + keywords (case-insensitive, whitespace-trimmed). A blank query
// returns the whole suite (registry order). Pure — unit-tested.
export const searchIcons = (query: string): MarkerIcon[] => {
  const q = (query ?? '').trim().toLowerCase();
  if (!q) {
    return MARKER_ICONS;
  }
  return MARKER_ICONS.filter(
    (i) => i.name.toLowerCase().includes(q) || i.keywords.some((k) => k.toLowerCase().includes(q))
  );
};
