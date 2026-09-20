import { create } from "@bufbuild/protobuf";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RelatedNotesDialog from "@/components/MemoActionMenu/RelatedNotesDialog";
import { RelatedMemoResultSchema } from "@/types/proto/api/v1/ai_service_pb";
import { MemoSchema } from "@/types/proto/api/v1/memo_service_pb";

const api = vi.hoisted(() => ({ findRelatedMemos: vi.fn() }));
const navigateTo = vi.hoisted(() => vi.fn());

vi.mock("@/connect", () => ({ aiServiceClient: api }));
vi.mock("@/hooks/useNavigateTo", () => ({ default: () => navigateTo }));
vi.mock("@/lib/error", () => ({ handleError: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/utils/i18n", () => ({ useTranslate: () => (key: string) => key }));

const memo = create(MemoSchema, { name: "memos/source", content: "A source note" });

describe("RelatedNotesInspector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.findRelatedMemos.mockResolvedValue({
      results: [
        create(RelatedMemoResultSchema, {
          memo: "memos/related",
          snippet: "A related note whose preview should remain readable across more than one line.",
          relevance: 0.86,
          sameTopic: 0.9,
          sameProblem: 0.4,
          continuation: 0.2,
        }),
      ],
    });
  });

  it("presents matches in a side inspector with readable previews and an accessible relevance meter", async () => {
    render(<RelatedNotesDialog memo={memo} onOpenChange={vi.fn()} />);

    const inspector = await screen.findByRole("dialog", { name: "related-notes.title" });
    expect(inspector).toHaveAttribute("data-slot", "sheet-content");
    expect(inspector).toHaveClass("sm:max-w-md");

    const match = screen.getByRole("button", { name: /A related note/ });
    expect(match.querySelector(".line-clamp-3")).toBeInTheDocument();
    expect(screen.getByText("related-notes.same-topic")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "related-notes.relevance" })).toHaveAttribute("aria-valuenow", "86");
  });

  it("closes the inspector and navigates when a match is opened", async () => {
    const onOpenChange = vi.fn();
    render(<RelatedNotesDialog memo={memo} onOpenChange={onOpenChange} />);

    fireEvent.click(await screen.findByRole("button", { name: /A related note/ }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(navigateTo).toHaveBeenCalledWith("/memos/related");
  });
});
