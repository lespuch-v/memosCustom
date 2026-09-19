import type { CSSProperties } from "react";
import { useEffect, useRef } from "react";
import { Navigate, Outlet, useLocation, useSearchParams } from "react-router-dom";
import AppSidebar, {
  MobileAppHeader,
  MobileAppSidebar,
  QuickFindDialog,
  SIDEBAR_WIDTH_VAR,
  SidebarResizeHandle,
  useSidebarWidth,
} from "@/components/AppSidebar";
import { SemanticAnalysisInspector } from "@/components/SemanticAnalysis";
import { AiContextProvider } from "@/contexts/AiContext";
import { AppSidebarProvider } from "@/contexts/AppSidebarContext";
import { GlobalMemoEditorProvider } from "@/contexts/GlobalMemoEditorContext";
import { useInstance } from "@/contexts/InstanceContext";
import { MemoFilterProvider, useMemoFilterContext } from "@/contexts/MemoFilterContext";
import { SpaceProvider } from "@/contexts/SpaceContext";
import { SemanticAnalysisProvider } from "@/contexts/SemanticAnalysisContext";
import useCurrentUser from "@/hooks/useCurrentUser";
import useMediaQuery from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";
import { ROUTES, resolveCollectionRoute } from "@/router/routes";
import { InstanceAccessMode, InstanceSetting_Key } from "@/types/proto/api/v1/instance_service_pb";
import { buildAuthRoute, shouldGatePrivateInstance } from "@/utils/auth-redirect";
import { useTranslate } from "@/utils/i18n";

const MEMOS_DEPLOY_URL = "https://usememos.com/docs/deploy";

const DemoBanner = () => {
  const t = useTranslate();

  return (
    <div className="static w-full shrink-0 border-b border-border bg-muted/70 px-4 py-2 text-sm text-muted-foreground sm:px-6">
      <div className="mx-auto flex max-w-5xl flex-col items-start gap-1 sm:flex-row sm:items-center sm:justify-center sm:gap-2">
        <span className="font-medium text-foreground">{t("demo.banner-title")}</span>
        <span>{t("demo.banner-description")}</span>
        <a className="font-medium text-primary underline-offset-4 hover:underline" href={MEMOS_DEPLOY_URL} target="_blank" rel="noreferrer">
          {t("demo.deploy-link")}
        </a>
      </div>
    </div>
  );
};

const RootLayoutContent = () => {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const currentUser = useCurrentUser();
  const md = useMediaQuery("md");
  const { profile, fetchSetting } = useInstance();
  const { removeFilter } = useMemoFilterContext();
  const { pathname } = location;
  // Routes that scroll inside themselves rather than with the document: the map
  // fills the viewport, and the AI Hub is a chat shell whose thread and context
  // panel each scroll on their own.
  const routePath = resolveCollectionRoute(pathname).pathname.toLowerCase();
  const fullBleed = routePath === ROUTES.MAP || routePath === ROUTES.AI;
  const prevPathnameRef = useRef<string | undefined>(undefined);
  const shellRef = useRef<HTMLDivElement>(null);
  const { width: sidebarWidth, minWidth, maxWidth, setWidth: setSidebarWidth } = useSidebarWidth();

  useEffect(() => {
    const prevPathname = prevPathnameRef.current;

    // When the route changes and there is no filter in the search params, remove all filters.
    if (prevPathname !== undefined && prevPathname !== pathname && !searchParams.has("filter")) {
      removeFilter(() => true);
    }

    prevPathnameRef.current = pathname;
  }, [pathname, searchParams, removeFilter]);

  useEffect(() => {
    if (currentUser) void fetchSetting(InstanceSetting_Key.AI);
  }, [currentUser, fetchSetting]);

  // Anonymous visitors to private instances may only reach share links. Treat an
  // unspecified mode as private so a partial or older response cannot expose content.
  if (
    shouldGatePrivateInstance({
      isPrivateInstance: profile.accessMode !== InstanceAccessMode.PUBLIC,
      isAuthenticated: !!currentUser,
      pathname,
    })
  ) {
    const redirect = `${pathname}${location.search}${location.hash}`;
    return <Navigate to={buildAuthRoute({ redirect })} replace />;
  }

  return (
    <div
      ref={shellRef}
      className={cn("w-full bg-background", fullBleed ? "h-dvh overflow-hidden" : "min-h-full")}
      style={{ [SIDEBAR_WIDTH_VAR]: `${sidebarWidth}px` } as CSSProperties}
    >
      {md && (
        <div className="fixed inset-y-0 start-0 z-30 w-(--app-sidebar-width) border-e border-border/70">
          <AppSidebar />
          <SidebarResizeHandle
            width={sidebarWidth}
            minWidth={minWidth}
            maxWidth={maxWidth}
            onWidthChange={setSidebarWidth}
            targetRef={shellRef}
          />
        </div>
      )}
      <MobileAppSidebar />
      <main
        className={cn("flex w-full min-w-0 flex-col items-center md:ps-(--app-sidebar-width)", fullBleed ? "h-full min-h-0" : "min-h-full")}
      >
        <MobileAppHeader />
        {profile.demo && <DemoBanner />}
        <Outlet />
      </main>
      <QuickFindDialog />
      <SemanticAnalysisInspector />
    </div>
  );
};

const RootLayout = () => (
  <SpaceProvider>
    <MemoFilterProvider>
      <AppSidebarProvider>
        {/* The AI selector is rendered by the sidebar while the conversation that
            reads the selection lives on the AI route, so the selection sits above
            both rather than inside the page. */}
        <AiContextProvider>
          <SemanticAnalysisProvider>
            <GlobalMemoEditorProvider>
              <RootLayoutContent />
            </GlobalMemoEditorProvider>
          </SemanticAnalysisProvider>
        </AiContextProvider>
      </AppSidebarProvider>
    </MemoFilterProvider>
  </SpaceProvider>
);

export default RootLayout;
