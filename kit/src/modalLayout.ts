// Shared modal face constraints, in the same pixels as the caller's layout.
export const MODAL_CONTENT = { minWidthFraction: 0.5, padding: 16 } as const;

// Content excludes padding; viewportWidth is the full logical viewport before safe margins.
// Height, text measurement and placement remain with the caller.
export function modalWidth(
  context: { readonly availableWidth: number; readonly viewportWidth: number },
  contentWidth: number,
): number {
  return Math.min(
    context.availableWidth,
    Math.max(
      contentWidth + 2 * MODAL_CONTENT.padding,
      context.viewportWidth * MODAL_CONTENT.minWidthFraction,
    ),
  );
}
