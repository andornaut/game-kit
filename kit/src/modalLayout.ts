// Shared modal face constraints, in the same pixels as the caller's layout.
export const MODAL_CONTENT = { minWidth: 320, padding: 16 } as const;

// The face width for content measured without padding, inside the caller's usable viewport.
// Height, text measurement and placement remain with the caller.
export function modalWidth(availableWidth: number, contentWidth: number): number {
  return Math.min(
    availableWidth,
    Math.max(contentWidth + 2 * MODAL_CONTENT.padding, MODAL_CONTENT.minWidth),
  );
}
