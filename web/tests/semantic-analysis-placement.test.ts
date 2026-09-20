import { describe, expect, it } from "vitest";
import { getSemanticAnalysisPlacement } from "@/components/SemanticAnalysis/placement";

describe("Semantic analysis placement", () => {
  it("places the inspector beside the memo card rather than its action trigger", () => {
    expect(
      getSemanticAnalysisPlacement({ left: 120, right: 720, top: 280, bottom: 480 }, { innerWidth: 1440, innerHeight: 900 }),
    ).toEqual({ side: "right", left: 732, top: 280, maxHeight: 604 });
  });

  it("flips left when the memo has no room on its right", () => {
    expect(
      getSemanticAnalysisPlacement({ left: 980, right: 1380, top: 120, bottom: 320 }, { innerWidth: 1440, innerHeight: 900 }),
    ).toEqual({ side: "left", left: 648, top: 120, maxHeight: 764 });
  });

  it("lifts the inspector above the viewport bottom when the card is cut off", () => {
    expect(
      getSemanticAnalysisPlacement({ left: 120, right: 720, top: 850, bottom: 1050 }, { innerWidth: 1440, innerHeight: 900 }),
    ).toEqual({ side: "right", left: 732, top: 564, maxHeight: 320 });
  });

  it("anchors a measured panel to the card's bottom when it does not fit below", () => {
    expect(
      getSemanticAnalysisPlacement({ left: 120, right: 720, top: 700, bottom: 860 }, { innerWidth: 1440, innerHeight: 900 }, 400),
    ).toEqual({ side: "right", left: 732, top: 460, maxHeight: 424 });
  });

  it("clamps to the viewport top when the panel is taller than the viewport", () => {
    expect(
      getSemanticAnalysisPlacement({ left: 120, right: 720, top: 700, bottom: 860 }, { innerWidth: 1440, innerHeight: 900 }, 1000),
    ).toEqual({ side: "right", left: 732, top: 16, maxHeight: 868 });
  });
});
