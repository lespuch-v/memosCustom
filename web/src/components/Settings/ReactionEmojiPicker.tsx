import { SmilePlusIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useTranslate } from "@/utils/i18n";
import { ALL_EMOJIS, EMOJI_GROUPS, type Emoji } from "./emojiCatalog";

interface Props {
  /** Emojis already configured; they render dimmed and unclickable. */
  configured: string[];
  /** Fired for each picked emoji; the popover stays open for multi-add. */
  onPick: (emoji: string) => void;
}

/** Emoji browser for curating the reaction pool. Click adds, search filters by emoji name. */
const ReactionEmojiPicker = ({ configured, onPick }: Props) => {
  const t = useTranslate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return null;
    }
    return ALL_EMOJIS.filter(([, name]) => name.includes(needle));
  }, [query]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" size="sm" aria-label={t("setting.memo.add-reaction")} />}>
        <SmilePlusIcon className="size-4" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-w-[90vw] p-0">
        <div className="p-2 pb-1">
          <Input className="h-8" placeholder={t("common.search")} value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        <div className="max-h-72 overflow-y-auto px-2 pb-2">
          {matches ? (
            matches.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{t("common.empty-placeholder")}</p>
            ) : (
              <EmojiGrid emojis={matches} configured={configured} onPick={onPick} />
            )
          ) : (
            EMOJI_GROUPS.map((group) => (
              <section key={group.name} className="mt-2 first:mt-0">
                <h4 className="mb-1 text-xs font-medium text-muted-foreground">{group.name}</h4>
                <EmojiGrid emojis={group.emojis} configured={configured} onPick={onPick} />
              </section>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

const EmojiGrid = ({ emojis, configured, onPick }: { emojis: Emoji[]; configured: string[]; onPick: (emoji: string) => void }) => (
  <div className="grid grid-cols-8 gap-0.5">
    {emojis.map(([emoji]) => {
      const taken = configured.includes(emoji);
      return (
        <button
          type="button"
          key={emoji}
          title={emoji}
          disabled={taken}
          className={cn(
            "rounded px-1 py-0.5 text-base cursor-pointer transition-colors hover:bg-accent",
            taken && "opacity-30 cursor-not-allowed",
          )}
          onClick={() => onPick(emoji)}
        >
          {emoji}
        </button>
      );
    })}
  </div>
);

export default ReactionEmojiPicker;
