import { create } from "@bufbuild/protobuf";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SemanticAnalysisProvider, useSemanticAnalysis } from "@/contexts/SemanticAnalysisContext";
import { MemoSchema } from "@/types/proto/api/v1/memo_service_pb";

const api = vi.hoisted(() => ({ analyzeMemoSemantic: vi.fn() }));
vi.mock("@/connect", () => ({ aiServiceClient: api }));
vi.mock("@/lib/error", () => ({ handleError: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/contexts/InstanceContext", () => ({ useInstance: () => ({ aiSetting: { semanticAnalysis: { providerId: "openrouter" } } }) }));

const memo = create(MemoSchema, {
  name: "memos/one",
  content: "Build the semantic inspector",
  updateTime: create(TimestampSchema, { seconds: 10n }),
});

const Harness = () => {
  const analysis = useSemanticAnalysis();
  return (
    <>
      <button type="button" onClick={(event) => analysis.openForMemo(memo, event.currentTarget)}>open</button>
      <button type="button" onClick={analysis.close}>close</button>
      <button type="button" onClick={analysis.refresh}>refresh</button>
      <output>{analysis.status}:{analysis.result?.ideaProbability}</output>
    </>
  );
};

describe("SemanticAnalysisProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.analyzeMemoSemantic.mockResolvedValue({ ideaProbability: 0.8, model: "~typesafe/jev-latest" });
  });

  it("caches a result for the same memo revision and supports an explicit refresh", async () => {
    render(<SemanticAnalysisProvider><Harness /></SemanticAnalysisProvider>);
    fireEvent.click(screen.getByText("open"));
    await screen.findByText("success:0.8");
    fireEvent.click(screen.getByText("close"));
    fireEvent.click(screen.getByText("open"));
    await screen.findByText("success:0.8");
    expect(api.analyzeMemoSemantic).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("refresh"));
    await waitFor(() => expect(api.analyzeMemoSemantic).toHaveBeenCalledTimes(2));
  });

  it("ignores a late response after closing", async () => {
    let resolve!: (value: unknown) => void;
    api.analyzeMemoSemantic.mockReturnValue(new Promise((done) => { resolve = done; }));
    render(<SemanticAnalysisProvider><Harness /></SemanticAnalysisProvider>);
    fireEvent.click(screen.getByText("open"));
    fireEvent.click(screen.getByText("close"));
    await act(async () => resolve({ ideaProbability: 1, model: "late" }));
    expect(screen.getByText("loading:")).toBeInTheDocument();
  });
});
