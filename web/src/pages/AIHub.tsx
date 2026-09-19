import { SettingsIcon, SparklesIcon, SquarePenIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import ChatComposer from "@/components/AIHub/ChatComposer";
import ChatThread from "@/components/AIHub/ChatThread";
import MemoContextPanel from "@/components/AIHub/MemoContextPanel";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { useAiContext } from "@/contexts/AiContext";
import { useInstance } from "@/contexts/InstanceContext";
import { useAiChat } from "@/hooks/useAiChat";
import { isChatCapableProviderType } from "@/lib/ai-providers";
import { cn } from "@/lib/utils";
import { ROUTES } from "@/router/routes";
import { InstanceSetting_Key } from "@/types/proto/api/v1/instance_service_pb";
import { useTranslate } from "@/utils/i18n";

/**
 * The AI Hub: chat with your notes, and let the model propose note changes that
 * you confirm. The conversation lives in this component (the server keeps no
 * chat state), while the notes the model may read are chosen in the sidebar and
 * shown beside the thread.
 */
const AIHub = () => {
  const t = useTranslate();
  const { aiSetting, fetchSetting, hasSetting } = useInstance();
  const { messages, isSending, progress, send, reset, resolveProposal } = useAiChat();
  const { filter, includeComments, estimate, estimateError } = useAiContext();
  const [isNewSessionOpen, setNewSessionOpen] = useState(false);

  // Startup only loads the general settings, so the AI setting has to be asked
  // for here. Without this the page reads an empty default and claims chat is not
  // configured, even on an instance that is configured.
  useEffect(() => {
    void fetchSetting(InstanceSetting_Key.AI).catch(() => undefined);
  }, [fetchSetting]);

  const chatConfig = aiSetting.chat;
  const providerId = chatConfig?.providerId ?? "";
  const model = chatConfig?.model ?? "";

  // Chat needs both a chat-capable provider and a model, so the page can explain
  // exactly what is missing instead of failing on send.
  const chatProvider = useMemo(() => aiSetting.providers.find((provider) => provider.id === providerId), [aiSetting.providers, providerId]);
  const isConfigured = Boolean(providerId && model && chatProvider && isChatCapableProviderType(chatProvider.type));
  // An unloaded setting and an unconfigured one look identical in the data, so
  // the page waits rather than telling the user to configure what already is.
  const isConfigLoading = !isConfigured && !hasSetting(InstanceSetting_Key.AI);

  // Retires a proposal once the user applies or discards it, so a settled
  // proposal cannot be applied twice.
  const handleProposalResolved = useCallback(
    (messageId: string, proposalId: string) => resolveProposal(messageId, proposalId),
    [resolveProposal],
  );

  const overBudget = estimate !== undefined && !estimate.fits;
  const sendDisabled = !isConfigured || overBudget || estimateError !== undefined;
  const sendDisabledReason = !isConfigured
    ? t("ai.not-configured")
    : estimateError !== undefined
      ? t("ai.context-estimate-failed")
      : overBudget
        ? t("ai.context-over-budget-send")
        : undefined;

  const handleSend = useCallback(
    (content: string) => {
      void send(content, {
        filter,
        includeComments,
        // The sidebar already measured this selection, so the progress indicator
        // can name real counts instead of guessing.
        estimatedMemoCount: estimate?.memoCount ?? 0,
        estimatedCommentCount: 0,
      });
    },
    [estimate?.memoCount, filter, includeComments, send],
  );

  if (isConfigLoading) {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-center gap-3 px-6 py-16 text-center">
        <SparklesIcon className="size-7 animate-pulse text-muted-foreground/60" strokeWidth={1.8} />
        <p className="text-sm text-muted-foreground">{t("ai.loading-config")}</p>
      </div>
    );
  }

  if (!isConfigured) {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-center gap-3 px-6 py-16 text-center">
        <SparklesIcon className="size-7 text-muted-foreground/60" strokeWidth={1.8} />
        <h1 className="text-lg font-semibold text-foreground">{t("ai.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("ai.not-configured")}</p>
        {/* A link, not a Button: it navigates, and a real anchor is what keeps Enter,
            middle-click and open-in-new-tab working. Wrapping it in Button's `render`
            slot instead would put `role="button"` on the anchor, which suppresses the
            anchor's own Enter activation. The AI setting is already fetched on mount,
            so settings has it in hand and will not flash its own loading state. */}
        <Link to={`${ROUTES.SETTING}#ai`} className={cn(buttonVariants({ variant: "outline" }))}>
          <SettingsIcon className="me-1.5 size-4" strokeWidth={2} />
          {t("ai.open-settings")}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 lg:flex-row">
      <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
        <header className="flex flex-wrap items-center gap-2">
          <h1 className="text-base font-semibold text-foreground">{t("ai.title")}</h1>
          <span className="font-mono text-xs text-muted-foreground">{model}</span>
          {/* Only offered once there is a thread to clear, and only while no reply
              is in flight: resetting mid-turn would let the reply land in a
              conversation the user has already left. */}
          {messages.length > 0 && (
            <Button
              variant="quiet"
              size="sm"
              className="ms-auto"
              disabled={isSending}
              onClick={() => setNewSessionOpen(true)}
              data-new-session-trigger
            >
              <SquarePenIcon className="size-3.5" strokeWidth={1.8} />
              {t("ai.new-session")}
            </Button>
          )}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">
          <ChatThread messages={messages} isSending={isSending} progress={progress} onProposalResolved={handleProposalResolved} />
        </div>

        <ChatComposer isSending={isSending} disabled={sendDisabled} disabledReason={sendDisabledReason} onSend={handleSend} />
      </section>

      {/* The selector lives in the app sidebar, so the thread keeps the wider
          column and the selection is shown rather than only counted. */}
      <MemoContextPanel className="hidden min-h-0 w-80 shrink-0 border-s border-border lg:flex lg:ps-4" />

      <ConfirmDialog
        open={isNewSessionOpen}
        onOpenChange={setNewSessionOpen}
        title={t("ai.new-session-title")}
        description={t("ai.new-session-description")}
        confirmLabel={t("ai.new-session-confirm")}
        cancelLabel={t("common.cancel")}
        onConfirm={reset}
      />
    </div>
  );
};

export default AIHub;
