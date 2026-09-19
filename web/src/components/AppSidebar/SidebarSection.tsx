import type { ReactNode } from "react";
import SidebarSectionHeader from "./SidebarSectionHeader";

export const SIDEBAR_SECTION_STACK_CLASSES = "flex flex-col gap-3";
export const SIDEBAR_SECTION_CONTENT_CLASSES = "flex flex-col gap-0.5";
// Section actions are the kit's quiet `icon-sm` buttons; only their glyph is section-specific.
export const SIDEBAR_SECTION_ACTION_ICON_CLASSES = "size-3.5";

interface Props {
  label?: ReactNode;
  ariaLabel?: string;
  children: ReactNode;
  action?: ReactNode;
}

const SidebarSection = ({ label, ariaLabel, children, action }: Props) => (
  // A label is both the visible heading and, on the section itself, its accessible
  // name: a named `section` is a landmark, so the rail's lists can be navigated to
  // by what they hold rather than only by their heading text.
  <section className="w-full" aria-label={ariaLabel ?? (typeof label === "string" ? label : undefined)}>
    {label !== undefined && <SidebarSectionHeader action={action}>{label}</SidebarSectionHeader>}
    {/* Flex gap keeps popup focus guards from affecting the visible row rhythm. */}
    <div className={SIDEBAR_SECTION_CONTENT_CLASSES}>{children}</div>
  </section>
);

export default SidebarSection;
