// layerControl.ts — pure helpers for the on-map LayerControl.
//
// Kept out of the React component so the group tri-state math is unit-testable
// (see layerControl.test.ts).

// The visibility of a group's checkbox, derived from its member layers:
//  - 'on'    : every layer in the group is visible  -> checked
//  - 'off'   : no layer in the group is visible     -> unchecked
//  - 'mixed' : some visible, some hidden            -> indeterminate
// An empty group is treated as 'off' (nothing to show).
export type GroupCheckState = 'on' | 'off' | 'mixed';

// Stable-sort `list` so items whose key appears in `order` come first, in the
// order given; every other item keeps its original relative position, appended
// after. Keys in `order` that don't match any item are ignored. An empty `order`
// leaves the list unchanged. Used to apply the layer menu's group/item ordering.
export const orderByKey = <T>(list: T[], keyOf: (t: T) => string, order: string[]): T[] => {
  if (!order || order.length === 0) {
    return list;
  }
  const rank = new Map<string, number>();
  order.forEach((k, i) => {
    if (!rank.has(k)) {
      rank.set(k, i);
    }
  });
  // Decorate with original index so unlisted items keep their relative order and
  // the sort is stable regardless of the engine's sort stability.
  return list
    .map((item, i) => ({ item, i, r: rank.has(keyOf(item)) ? rank.get(keyOf(item))! : Infinity }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((d) => d.item);
};

export const groupCheckState = (ids: string[], visibility: Record<string, boolean>): GroupCheckState => {
  if (ids.length === 0) {
    return 'off';
  }
  // A layer counts as visible unless explicitly set false (matches the panel's
  // `visibility[id] !== false` convention used everywhere else).
  let visible = 0;
  for (const id of ids) {
    if (visibility[id] !== false) {
      visible++;
    }
  }
  if (visible === 0) {
    return 'off';
  }
  if (visible === ids.length) {
    return 'on';
  }
  return 'mixed';
};
