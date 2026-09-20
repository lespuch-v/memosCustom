const INSPECTOR_WIDTH = 320;
// Assumed height before the panel is measured; keeps the first painted frame
// sensible when the card sits near the viewport bottom.
const INSPECTOR_ASSUMED_HEIGHT = 320;
const INSPECTOR_GAP = 12;
const VIEWPORT_GUTTER = 16;

export interface SemanticAnalysisPlacement {
  side: "left" | "right";
  left: number;
  top: number;
  /** Bounded height so the panel never extends past the viewport bottom. */
  maxHeight: number;
}

export const getSemanticAnalysisPlacement = (
  card: Pick<DOMRect, "left" | "right" | "top" | "bottom">,
  viewport: Pick<Window, "innerWidth" | "innerHeight">,
  panelHeight?: number,
): SemanticAnalysisPlacement => {
  const canFitRight = card.right + INSPECTOR_GAP + INSPECTOR_WIDTH <= viewport.innerWidth - VIEWPORT_GUTTER;
  const height = panelHeight ?? INSPECTOR_ASSUMED_HEIGHT;
  // Align with the card's top. If the panel does not fit below the card, anchor
  // its bottom edge to the card's bottom so it grows upward into the free space.
  let top = card.top;
  if (top + height > viewport.innerHeight - VIEWPORT_GUTTER) {
    top = Math.min(card.bottom, viewport.innerHeight - VIEWPORT_GUTTER) - height;
  }
  // Final clamp keeps a runaway panel inside the viewport; the component then
  // scrolls internally if the content is taller than the viewport allows.
  top = Math.max(VIEWPORT_GUTTER, Math.min(top, viewport.innerHeight - VIEWPORT_GUTTER));
  return {
    side: canFitRight ? "right" : "left",
    left: canFitRight
      ? card.right + INSPECTOR_GAP
      : Math.max(VIEWPORT_GUTTER, card.left - INSPECTOR_GAP - INSPECTOR_WIDTH),
    top,
    maxHeight: viewport.innerHeight - top - VIEWPORT_GUTTER,
  };
};
