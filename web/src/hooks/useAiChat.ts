import { useCallback, useEffect, useState } from "react";
import { toast } from "react-hot-toast";
import { aiServiceClient } from "@/connect";
import { handleError } from "@/lib/error";
import { ChatMessageRole, type ChatProposal } from "@/types/proto/api/v1/ai_service_pb";

export type HubProposal = ChatProposal & { clientId: string };

/** One turn as the Hub holds it. The server keeps no conversation state. */
export interface HubMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Note changes the model proposed with this reply. Never applied here. */
  proposals: HubProposal[];
  /** Context receipt: how many notes this reply actually read. */
  contextMemoCount: number;
  /** How many comments this reply read alongside those notes. */
  contextCommentCount: number;
  contextEstimatedTokens: number;
  /** True when the provider stopped because the reply hit the token limit. */
  truncated: boolean;
}

export interface SendChatTurnOptions {
  filter: string;
  /** Whether each selected note's comment thread is sent with the turn. */
  includeComments: boolean;
  /** Notes the sidebar measured for this selection, for the progress indicator. */
  estimatedMemoCount?: number;
  /** Comments the selection will carry, when comments are included. */
  estimatedCommentCount?: number;
}

const createMessageId = (): string => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;

/** Removes exactly one proposal without relying on its mutable array position. */
export const retireProposal = (messages: HubMessage[], messageId: string, proposalId: string): HubMessage[] =>
  messages.map((message) =>
    message.id === messageId
      ? { ...message, proposals: message.proposals.filter((proposal) => proposal.clientId !== proposalId) }
      : message,
  );

export type ChatPhase = "idle" | "preparing" | "resolving" | "asking" | "receiving" | "proposals";

/** How long one rotating phrase stays on screen before the next replaces it. */
export const PHASE_PHRASE_INTERVAL_MS = 2600;

/** How many phrases each phase owns. Kept here so the rotation and the catalog agree. */
export const PHASE_PHRASE_COUNT = 5;

/**
 * Picks the phrase a phase shows at a given tick. Pure so the rotation is testable
 * without a clock: the caller advances the tick, this decides what it reads as.
 */
export const phasePhraseKey = (phase: ChatPhase, tick: number): string => {
  const index = ((tick % PHASE_PHRASE_COUNT) + PHASE_PHRASE_COUNT) % PHASE_PHRASE_COUNT;
  return `ai.phase-${phase}-${index + 1}`;
};

/** What a running turn is doing right now, for the progress indicator. */
export interface ChatProgress {
  phase: ChatPhase;
  /** Advances while a phase is on screen, so its phrase rotates. */
  tick: number;
  /** How many notes the turn will read, once the selection has been resolved. */
  memoCount: number;
  /** How many comments ride along with those notes, when they were included. */
  commentCount: number;
}

const IDLE_PROGRESS: ChatProgress = { phase: "idle", tick: 0, memoCount: 0, commentCount: 0 };

/**
 * One frame's worth of delay, used between phases. Without a yield React batches
 * consecutive phase changes into a single render and the user never sees the
 * earlier ones; with it, each phase the Hub actually passes through is painted.
 */
const yieldToPaint = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 16));

export interface UseAiChatOptions {
  /** Overridden in tests so phase transitions do not depend on wall-clock time. */
  yieldToPaint?: () => Promise<void>;
  /**
   * Called with every progress change as it is made. React can coalesce two
   * consecutive phases into one paint, so observing the changes themselves is the
   * only way to know the sequence a turn actually went through.
   */
  onProgress?: (progress: ChatProgress) => void;
}

/**
 * Owns the Hub conversation and drives the Chat RPC. The whole transcript is
 * resent every turn, which is what keeps the server stateless.
 *
 * It also reports which phase a turn is in. The Chat RPC is unary, so this cannot
 * show tokens arriving; it reports what the Hub itself is doing, which is honest
 * and needs no provider-specific support.
 */
export const useAiChat = ({ yieldToPaint: yieldPhase = yieldToPaint, onProgress }: UseAiChatOptions = {}) => {
  const [messages, setMessages] = useState<HubMessage[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [progress, setProgress] = useState<ChatProgress>(IDLE_PROGRESS);

  // Every phase change goes through here, so a caller can follow the sequence
  // even when rendering coalesces two of them.
  const reportProgress = useCallback(
    (next: ChatProgress) => {
      onProgress?.(next);
      setProgress(next);
    },
    [onProgress],
  );

  // Rotate the current phase's phrase. Only runs while a turn is in flight, so an
  // idle page never re-renders on a timer.
  useEffect(() => {
    if (progress.phase === "idle") return;
    const timer = window.setInterval(() => {
      setProgress((previous) => ({ ...previous, tick: previous.tick + 1 }));
    }, PHASE_PHRASE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [progress.phase]);

  const reset = useCallback(() => {
    setMessages([]);
    reportProgress(IDLE_PROGRESS);
  }, [reportProgress]);

  /** Retires a proposal after the user acts on it. */
  const resolveProposal = useCallback((messageId: string, proposalId: string) => {
    setMessages((previous) => retireProposal(previous, messageId, proposalId));
  }, []);

  const send = useCallback(
    async (content: string, options: SendChatTurnOptions): Promise<boolean> => {
      const trimmed = content.trim();
      if (trimmed === "" || isSending) return false;

      const userMessage: HubMessage = {
        id: createMessageId(),
        role: "user",
        content: trimmed,
        proposals: [],
        contextMemoCount: 0,
        contextCommentCount: 0,
        contextEstimatedTokens: 0,
        truncated: false,
      };

      // Snapshot the transcript before adding the new turn so the request body
      // carries the conversation up to and including the new user message.
      const transcript = [...messages, userMessage];
      setMessages(transcript);
      setIsSending(true);

      // The counts are already known from the estimate the sidebar keeps, so the
      // early phases report real numbers instead of a bare spinner.
      const memoCount = options.estimatedMemoCount ?? 0;
      const commentCount = options.includeComments ? (options.estimatedCommentCount ?? 0) : 0;

      try {
        reportProgress({ phase: "preparing", tick: 0, memoCount: 0, commentCount: 0 });
        await yieldPhase();
        reportProgress({ phase: "resolving", tick: 0, memoCount, commentCount });
        await yieldPhase();

        reportProgress({ phase: "asking", tick: 0, memoCount, commentCount });
        const response = await aiServiceClient.chat({
          filter: options.filter,
          includeComments: options.includeComments,
          messages: transcript.map((message) => ({
            role: message.role === "user" ? ChatMessageRole.USER : ChatMessageRole.ASSISTANT,
            content: message.content,
          })),
        });

        // The reply arrives whole, so what is left is reading it: that is where
        // proposals are recovered from its JSON block. Each of these gets a frame
        // so the sequence is visible instead of collapsing into one repaint.
        reportProgress({ phase: "receiving", tick: 0, memoCount, commentCount });
        await yieldPhase();
        reportProgress({ phase: "proposals", tick: 0, memoCount, commentCount });
        await yieldPhase();

        setMessages((previous) => [
          ...previous,
          {
            id: createMessageId(),
            role: "assistant",
            content: response.content,
            proposals: response.proposals.map((proposal) => ({ ...proposal, clientId: createMessageId() })),
            contextMemoCount: Number(response.contextMemoCount),
            contextCommentCount: Number(response.contextCommentCount),
            contextEstimatedTokens: Number(response.contextEstimatedTokens),
            truncated: response.truncated,
          },
        ]);
        return true;
      } catch (error: unknown) {
        // The user's message stays in the thread so the draft is never lost;
        // the error is reported alongside it.
        await handleError(error, toast.error, { context: "AI chat" });
        return false;
      } finally {
        setIsSending(false);
        reportProgress(IDLE_PROGRESS);
      }
    },
    [isSending, messages],
  );

  return { messages, isSending, progress, send, reset, resolveProposal };
};
