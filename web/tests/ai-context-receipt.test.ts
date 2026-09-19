import { describe, expect, it } from "vitest";
import { describeContextReceipt } from "@/components/AIHub/ChatThread";

// Stands in for the real translator: the receipt's job is which keys it asks
// for and how it joins them, not the catalog wording.
const translate = (key: string, params?: Record<string, unknown>): string =>
  params ? `${key}:${JSON.stringify(params)}` : key;

describe("describeContextReceipt", () => {
  it("says plainly when the turn read nothing", () => {
    expect(describeContextReceipt(0, 0, translate)).toBe("ai.receipt-no-context");
  });

  it("reports notes without mentioning comments when none were read", () => {
    expect(describeContextReceipt(3, 0, translate)).toBe('ai.receipt-context:{"count":3}');
  });

  it("reports comments alongside the notes they came from", () => {
    expect(describeContextReceipt(3, 7, translate)).toBe('ai.receipt-context:{"count":3} · ai.receipt-comments:{"count":7}');
  });

  it("still reports comments when the notes themselves could not be read", () => {
    // Defensive: the server never injects comments without notes, but a receipt
    // that hid them would misreport what the model actually read.
    expect(describeContextReceipt(0, 2, translate)).toBe('ai.receipt-no-context · ai.receipt-comments:{"count":2}');
  });
});
