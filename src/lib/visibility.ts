interface Visibility { visible: boolean; wireframe?: boolean }

/** Keep semi-visible items out of all existing solid visibility and picking paths. */
export function nextVisibility(item: Visibility): Visibility {
  return item.visible ? { visible: false, wireframe: true }
    : item.wireframe ? { visible: false, wireframe: false }
      : { visible: true, wireframe: false }
}
export function visibilityAction(item: Visibility): string {
  return item.visible ? 'Show wireframe of' : item.wireframe ? 'Hide' : 'Show'
}
