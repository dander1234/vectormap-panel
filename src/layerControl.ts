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
