const INSPECTOR_WIDTH = 320;
const INSPECTOR_GAP = 12;
const VIEWPORT_GUTTER = 16;

export interface SemanticAnalysisPlacement {
  side: "left" | "right";
  left: number;
  top: number;
}

export const getSemanticAnalysisPlacement = (
  card: Pick<DOMRect, "left" | "right" | "top" | "bottom">,
  viewport: Pick<Window, "innerWidth" | "innerHeight">,
): SemanticAnalysisPlacement => {
  const canFitRight = card.right + INSPECTOR_GAP + INSPECTOR_WIDTH <= viewport.innerWidth - VIEWPORT_GUTTER;
  return {
    side: canFitRight ? "right" : "left",
    left: canFitRight
      ? card.right + INSPECTOR_GAP
      : Math.max(VIEWPORT_GUTTER, card.left - INSPECTOR_GAP - INSPECTOR_WIDTH),
    top: Math.max(VIEWPORT_GUTTER, Math.min(card.top, viewport.innerHeight - VIEWPORT_GUTTER)),
  };
};
