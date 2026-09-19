import { useEffect, useMemo, useRef } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { DEFAULT_SETTING_SECTION, SETTINGS_SECTIONS, type SettingSectionKey } from "@/components/Settings/settingSections";
import { useInstance } from "@/contexts/InstanceContext";
import useCurrentUser from "@/hooks/useCurrentUser";
import { User_Role } from "@/types/proto/api/v1/user_service_pb";

const Setting = () => {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const user = useCurrentUser();
  const { fetchSettings } = useInstance();
  const isHost = user?.role === User_Role.ADMIN;

  const sectionGroups = useMemo(() => {
    const visibleSections = SETTINGS_SECTIONS.filter((section) => section.scope === "basic" || isHost);
    return {
      admin: visibleSections.filter((section) => section.scope === "admin"),
      all: visibleSections,
    };
  }, [isHost]);

  // The route asks for a section either as a query parameter, the way another page
  // deep-links into one, or as the hash the sidebar links with. The request is
  // resolved against what this visitor may see, so naming a hidden section falls
  // back instead of reaching it. Derived rather than stored: the sidebar reads the
  // hash with no React state in between, and two copies of this would drift.
  const selectedSection = useMemo((): SettingSectionKey => {
    const requested = searchParams.get("section") ?? location.hash.slice(1);
    return sectionGroups.all.some((section) => section.key === requested) ? (requested as SettingSectionKey) : DEFAULT_SETTING_SECTION;
  }, [location.hash, searchParams, sectionGroups.all]);

  // Jump back to the top when switching sections; skip the first run so scroll
  // restoration on back-navigation still wins.
  const prevSectionRef = useRef<SettingSectionKey | null>(null);
  useEffect(() => {
    if (prevSectionRef.current && prevSectionRef.current !== selectedSection) {
      window.scrollTo({ top: 0 });
    }
    prevSectionRef.current = selectedSection;
  }, [selectedSection]);

  // Publishing the query-parameter request into the hash. The sidebar reads the
  // hash with no React state in between, so without this a deep link would show
  // the section while the list highlighted nothing.
  useEffect(() => {
    if (searchParams.get("section") === null || location.hash.slice(1) === selectedSection) {
      return;
    }
    // Relabelling the current history entry rather than pushing a new one: one
    // Back press must leave settings, not step from a section to its own hash.
    // Written directly because the route is what the sidebar reads.
    const query = new URLSearchParams(searchParams);
    query.delete("section");
    const rest = query.toString();
    const nextUrl = `${location.pathname}${rest ? `?${rest}` : ""}#${selectedSection}`;
    window.history.replaceState(null, "", nextUrl);
  }, [location.hash, location.pathname, searchParams, selectedSection]);

  useEffect(() => {
    if (!isHost) {
      return;
    }
    const preloadSettingKeys = new Set(sectionGroups.admin.flatMap((section) => section.preloadSettingKeys ?? []));
    void fetchSettings([...preloadSettingKeys]);
  }, [fetchSettings, isHost, sectionGroups.admin]);

  const selectedSectionDefinition =
    sectionGroups.all.find((section) => section.key === selectedSection) ??
    SETTINGS_SECTIONS.find((section) => section.key === DEFAULT_SETTING_SECTION) ??
    SETTINGS_SECTIONS[0];
  const ActiveSection = selectedSectionDefinition.component;

  return (
    <section className="w-full min-h-full">
      <div className="mx-auto w-full max-w-4xl px-4 pb-12 pt-4 sm:px-6 md:pt-8">
        <div className="min-w-0">
          <ActiveSection />
        </div>
      </div>
    </section>
  );
};

export default Setting;
