import { describe, expect, it } from "vitest";
import { getSemanticAnalysisPlacement } from "@/components/SemanticAnalysis/placement";

describe("Semantic analysis placement", () => {
  it("places the inspector beside the memo card rather than its action trigger", () => {
    expect(
      getSemanticAnalysisPlacement({ left: 120, right: 720, top: 280, bottom: 480 }, { innerWidth: 1440, innerHeight: 900 }),
    ).toEqual({ side: "right", left: 732, top: 280 });
  });

  it("flips left when the memo has no room on its right", () => {
    expect(
      getSemanticAnalysisPlacement({ left: 980, right: 1380, top: 120, bottom: 320 }, { innerWidth: 1440, innerHeight: 900 }),
    ).toEqual({ side: "left", left: 648, top: 120 });
  });
});
