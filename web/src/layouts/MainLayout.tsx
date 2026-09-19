import { Outlet, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { ROUTES } from "@/router/routes";

const MainLayout = () => {
  const { pathname } = useLocation();
  // The AI Hub is a chat shell: the thread scrolls inside itself and the context
  // panel scrolls independently, which needs a definite height. Every other route
  // grows with its content instead.
  const fillsViewport = pathname === ROUTES.AI;

  return (
    <section className={cn("@container flex w-full flex-col items-center", fillsViewport ? "h-full min-h-0" : "min-h-full")}>
      <div className={cn("mx-auto w-full px-4 sm:px-6", fillsViewport ? "flex min-h-0 flex-1 flex-col pb-4 pt-3" : "pb-8 pt-3 md:pt-6")}>
        <Outlet />
      </div>
    </section>
  );
};

export default MainLayout;
