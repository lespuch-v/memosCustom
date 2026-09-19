import { SparklesIcon, TriangleAlertIcon, UserRoundIcon } from "lucide-react";
import { type ChatProgress, type HubMessage, phasePhraseKey } from "@/hooks/useAiChat";
import { cn } from "@/lib/utils";
import { type Translations, useTranslate } from "@/utils/i18n";
import ProposalCard from "./ProposalCard";

interface ChatThreadProps {
  messages: HubMessage[];
  isSending: boolean;
  /** What the running turn is doing, for the progress indicator. */
  progress: ChatProgress;
  /** Retires one proposal from a message after the user acts on it. */
  onProposalResolved: (messageId: string, proposalId: string) => void;
}

/**
 * Describes what one reply actually read. Comments are reported separately
 * because they are opt-in: a turn that included them must not look identical to
 * one that did not.
 */
export const describeContextReceipt = (
  memoCount: number,
  commentCount: number,
  translate: (key: Translations, params?: Record<string, unknown>) => string,
): string => {
  const notes = memoCount === 0 ? translate("ai.receipt-no-context") : translate("ai.receipt-context", { count: memoCount });
  if (commentCount === 0) return notes;
  return `${notes} · ${translate("ai.receipt-comments", { count: commentCount })}`;
};

/**
 * The second line of the progress indicator: the real numbers behind the wait,
 * or undefined when the phase has nothing concrete to report. Phases that cannot
 * know their numbers say nothing rather than showing a zero.
 */
export const describePhaseContext = (
  progress: ChatProgress,
  translate: (key: Translations, params?: Record<string, unknown>) => string,
): string | undefined => {
  if (progress.phase === "resolving") {
    const notes = translate("ai.phase-resolving-context", { count: progress.memoCount });
    if (progress.commentCount === 0) return notes;
    return translate("ai.phase-resolving-context-comments", {
      count: progress.memoCount,
      comments: translate("ai.receipt-comments", { count: progress.commentCount }),
    });
  }
  if (progress.phase === "asking") {
    return translate("ai.phase-asking-context", { notes: translate("ai.receipt-context", { count: progress.memoCount }) });
  }
  return undefined;
};

/** Renders the conversation, including the note changes the model proposed. */
const ChatThread = ({ messages, isSending, progress, onProposalResolved }: ChatThreadProps) => {
  const t = useTranslate();
  const phaseContext = describePhaseContext(progress, t);

  if (messages.length === 0 && !isSending) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <SparklesIcon className="size-6 text-muted-foreground/60" strokeWidth={1.8} />
        <p className="text-sm font-medium text-foreground">{t("ai.empty-title")}</p>
        <p className="max-w-md text-xs text-muted-foreground">{t("ai.empty-description")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {messages.map((message) => (
        <div key={message.id} className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded-full border border-border",
                message.role === "user" ? "bg-muted" : "bg-primary/10",
              )}
              aria-hidden
            >
              {message.role === "user" ? (
                <UserRoundIcon className="size-3 text-muted-foreground" strokeWidth={2} />
              ) : (
                <SparklesIcon className="size-3 text-primary" strokeWidth={2} />
              )}
            </span>
            <span className="text-xs font-medium text-muted-foreground">
              {message.role === "user" ? t("ai.role-you") : t("ai.role-assistant")}
            </span>
            {message.role === "assistant" && (
              <span className="text-xs text-muted-foreground/70">
                {describeContextReceipt(message.contextMemoCount, message.contextCommentCount, t)}
              </span>
            )}
          </div>

          <div className="ps-7">
            <div className="whitespace-pre-wrap break-words text-sm text-foreground">{message.content}</div>

            {message.truncated && (
              <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                <TriangleAlertIcon className="size-3.5" strokeWidth={2} />
                {t("ai.truncated-reply")}
              </p>
            )}

            {message.proposals.length > 0 && (
              <div className="mt-3 flex flex-col gap-2">
                {message.proposals.map((proposal) => (
                  <ProposalCard
                    key={proposal.clientId}
                    proposal={proposal}
                    onApplied={() => onProposalResolved(message.id, proposal.clientId)}
                    onDiscarded={() => onProposalResolved(message.id, proposal.clientId)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      ))}

      {isSending && progress.phase !== "idle" && (
        <div className="flex items-start gap-2 ps-7 text-xs text-muted-foreground" role="status" aria-live="polite">
          <SparklesIcon className="mt-0.5 size-3.5 shrink-0 animate-pulse text-primary" strokeWidth={2} />
          <div className="flex flex-col gap-0.5">
            <span className="text-foreground">{t(`ai.phase-${progress.phase}-label` as Translations)}</span>
            {/* aria-hidden: the rotating joke should not interrupt a screen reader
                every couple of seconds. The phase label above is the real status. */}
            <span aria-hidden="true">{t(phasePhraseKey(progress.phase, progress.tick) as Translations)}</span>
            {phaseContext && <span className="text-muted-foreground/70">{phaseContext}</span>}
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatThread;
