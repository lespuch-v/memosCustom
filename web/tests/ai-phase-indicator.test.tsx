import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { describePhaseContext } from "@/components/AIHub/ChatThread";
import { PHASE_PHRASE_COUNT, PHASE_PHRASE_INTERVAL_MS, phasePhraseKey, useAiChat } from "@/hooks/useAiChat";
import en from "@/locales/en.json";

const api = vi.hoisted(() => ({ chat: vi.fn() }));
vi.mock("@/connect", () => ({ aiServiceClient: api }));
vi.mock("@/lib/error", () => ({ handleError: vi.fn().mockResolvedValue(undefined) }));
vi.mock("react-hot-toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

const reply = {
  content: "hello back",
  proposals: [],
  contextMemoCount: 1n,
  contextCommentCount: 0n,
  contextEstimatedTokens: 5n,
  truncated: false,
};

/** Reads a key straight out of the catalog, so the assertions check real copy. */
const translate = (key: string, params?: Record<string, unknown>): string => {
  const raw = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], en);
  if (typeof raw !== "string") throw new Error(`missing catalog key: ${key}`);
  return Object.entries(params ?? {}).reduce((text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)), raw);
};

const immediateYield = () => Promise.resolve();

/**
 * Renders the hook and records every phase it passes through. React can coalesce
 * two phases into one paint, so the recorded sequence — not the render count — is
 * what proves the turn went through them.
 */
const renderChat = () => {
  const phases: string[] = [];
  const rendered = renderHook(() => useAiChat({ yieldToPaint: immediateYield, onProgress: (p) => phases.push(p.phase) }), { wrapper });
  return { ...rendered, phases };
};

/**
 * Renders the hook with the first yield held open, so a turn can be observed
 * waiting on the model without any real time passing. Later yields resolve
 * immediately, which keeps the rest of the turn synchronous.
 */
const renderChatHeldOnFirstPhase = () => {
  let openGate: (() => void) | undefined;
  let gated = true;
  const gate = () => {
    if (!gated) return Promise.resolve();
    gated = false;
    return new Promise<void>((resolve) => {
      openGate = resolve;
    });
  };

  const rendered = renderHook(() => useAiChat({ yieldToPaint: gate }), { wrapper });
  return {
    ...rendered,
    /** Lets the turn move past its first phase. */
    advance: async () => {
      const release = openGate;
      await act(async () => {
        release?.();
      });
    },
  };
};

/** Starts a turn and returns a handle to settle the pending RPC. */
const startTurn = async (
  result: { current: ReturnType<typeof useAiChat> },
  options: Parameters<ReturnType<typeof useAiChat>["send"]>[1] = { filter: "", includeComments: false },
) => {
  let release: (() => void) | undefined;
  api.chat.mockImplementation(() => new Promise((resolve) => (release = () => resolve(reply))));

  const send = result.current.send;
  let sendPromise: Promise<boolean> | undefined;
  await act(async () => {
    sendPromise = send("hi", options);
  });

  return {
    settle: async () => {
      await act(async () => {
        release?.();
        await sendPromise;
      });
    },
  };
};

describe("phase phrase rotation", () => {
  it("walks every phrase of a phase and wraps around", () => {
    const seen = Array.from({ length: PHASE_PHRASE_COUNT }, (_, tick) => phasePhraseKey("asking", tick));

    expect(new Set(seen).size).toBe(PHASE_PHRASE_COUNT);
    expect(phasePhraseKey("asking", PHASE_PHRASE_COUNT)).toBe(seen[0]);
  });

  it("keeps each phase on its own phrases", () => {
    expect(phasePhraseKey("preparing", 0)).toBe("ai.phase-preparing-1");
    expect(phasePhraseKey("proposals", 2)).toBe("ai.phase-proposals-3");
  });

  it("resolves every phase phrase to real copy in the catalog", () => {
    // A typo in the key pattern would otherwise show a raw key to the user.
    for (const phase of ["preparing", "resolving", "asking", "receiving", "proposals"] as const) {
      for (let tick = 0; tick < PHASE_PHRASE_COUNT; tick++) {
        expect(translate(phasePhraseKey(phase, tick))).not.toContain("ai.phase-");
      }
    }
  });

  it("resolves the label every phase is rendered under", () => {
    for (const phase of ["preparing", "resolving", "asking", "receiving", "proposals"] as const) {
      expect(translate(`ai.phase-${phase}-label`)).not.toContain("ai.phase-");
    }
  });

  it("handles a negative tick without leaving the phrase list", () => {
    expect(phasePhraseKey("asking", -1)).toBe(phasePhraseKey("asking", PHASE_PHRASE_COUNT - 1));
  });
});

describe("phase context line", () => {
  const progress = (over: Partial<Parameters<typeof describePhaseContext>[0]>) => ({
    phase: "resolving" as const,
    tick: 0,
    memoCount: 0,
    commentCount: 0,
    ...over,
  });

  it("reports how many notes a turn will read", () => {
    expect(describePhaseContext(progress({ memoCount: 12 }), translate)).toBe("Read 12 note(s) under your access scope.");
  });

  it("names comments separately when the toggle included them", () => {
    const line = describePhaseContext(progress({ memoCount: 12, commentCount: 4 }), translate);

    expect(line).toContain("12 note(s)");
    expect(line).toContain("4 comment(s)");
  });

  it("says nothing for phases that have no numbers to report", () => {
    expect(describePhaseContext(progress({ phase: "preparing" }), translate)).toBeUndefined();
    expect(describePhaseContext(progress({ phase: "receiving" }), translate)).toBeUndefined();
  });

  it("tells the user the wait is expected once the request is out", () => {
    const line = describePhaseContext(progress({ phase: "asking", memoCount: 3 }), translate);

    expect(line).toContain("read 3 note(s)");
  });
});

describe("phase reporting while a turn runs", () => {
  beforeEach(() => {
    // A turn held open by a previous test leaves Testing Library's async cleanup
    // pending; it would otherwise unmount the next test's hook mid-await.
    cleanup();
    api.chat.mockReset();
    api.chat.mockResolvedValue(reply);
  });

  it("starts idle and returns to idle once the reply lands", async () => {
    const { result } = renderChat();
    const send = result.current.send;
    expect(result.current.progress.phase).toBe("idle");

    await act(() => send("hi", { filter: "", includeComments: false }));

    expect(result.current.progress.phase).toBe("idle");
    expect(result.current.isSending).toBe(false);
  });

  it("reports the phases in the order the turn actually goes through them", async () => {
    const { result, phases } = renderChat();

    const turn = await startTurn(result, { filter: "", includeComments: false, estimatedMemoCount: 7 });

    // Waiting on the model is the long one, so it must be observable while the
    // request is genuinely in flight rather than only after it resolves.
    expect(result.current.progress.phase).toBe("asking");
    expect(result.current.progress.memoCount).toBe(7);

    await turn.settle();

    // The turn must pass through every phase in order: a phase the user never
    // reaches is a phase that should not be in the list.
    expect(phases).toEqual(["preparing", "resolving", "asking", "receiving", "proposals", "idle"]);
  });

  it("carries the measured note count into the asking phase", async () => {
    const { result } = renderChat();

    const turn = await startTurn(result, { filter: "", includeComments: true, estimatedMemoCount: 9, estimatedCommentCount: 3 });

    expect(result.current.progress.memoCount).toBe(9);
    expect(result.current.progress.commentCount).toBe(3);

    await turn.settle();
  });

  it("drops comments from the count when the toggle was off", async () => {
    const { result } = renderChat();

    const turn = await startTurn(result, { filter: "", includeComments: false, estimatedMemoCount: 9, estimatedCommentCount: 3 });

    expect(result.current.progress.commentCount).toBe(0);

    await turn.settle();
  });

  it("rotates the phrase while the model is still working", async () => {
    // The gate holds the turn on its first phase, so no real time has to pass for
    // the rotation interval to be observed.
    const { result, advance } = renderChatHeldOnFirstPhase();
    let release: (() => void) | undefined;
    api.chat.mockImplementation(() => new Promise((resolve) => (release = () => resolve(reply))));

    vi.useFakeTimers();
    try {
      const send = result.current.send;
      let sendPromise: Promise<boolean> | undefined;
      await act(async () => {
        sendPromise = send("hi", { filter: "", includeComments: false });
      });
      expect(result.current.progress.phase).toBe("preparing");

      const firstPhrase = phasePhraseKey(result.current.progress.phase, result.current.progress.tick);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(PHASE_PHRASE_INTERVAL_MS * 2);
      });

      // The whole point of the indicator: a long wait must visibly move.
      expect(result.current.progress.tick).toBe(2);
      expect(phasePhraseKey(result.current.progress.phase, result.current.progress.tick)).not.toBe(firstPhrase);

      // Release the gate, then the RPC, so the turn finishes and the phase
      // effect's interval is cleaned up.
      await advance();
      await act(async () => {
        release?.();
        await sendPromise;
      });
      expect(result.current.progress.phase).toBe("idle");
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops the rotation when the turn ends, so an idle page is not on a timer", async () => {
    const { result } = renderChat();
    const send = result.current.send;

    await act(async () => {
      await send("hi", { filter: "", includeComments: false });
    });
    expect(result.current.progress.phase).toBe("idle");

    vi.useFakeTimers();
    try {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(PHASE_PHRASE_INTERVAL_MS * 3);
      });
    } finally {
      vi.useRealTimers();
    }

    expect(result.current.progress.tick).toBe(0);
  });

  it("clears the indicator when a turn fails", async () => {
    api.chat.mockRejectedValue(new Error("provider is down"));

    const { result } = renderChat();
    const send = result.current.send;

    await act(async () => {
      await send("hi", { filter: "", includeComments: false });
    });

    // A failed turn must not leave the indicator spinning forever.
    await waitFor(() => expect(result.current.progress.phase).toBe("idle"));
    expect(result.current.isSending).toBe(false);
  });

  it("clears the indicator when a new session starts", async () => {
    const { result } = renderChat();

    const turn = await startTurn(result);
    expect(result.current.progress.phase).toBe("asking");

    act(() => result.current.reset());
    expect(result.current.progress.phase).toBe("idle");

    await turn.settle();
  });
});
