import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { Root } from "@/components/Root";
import { HomePage } from "@/routes/home";

const WorkspacePage = lazy(() => import("@/routes/workspace").then((m) => ({ default: m.WorkspacePage })));
const SettingsPage = lazy(() => import("@/routes/settings").then((m) => ({ default: m.SettingsPage })));

const rootRoute = createRootRoute({
  component: () => (
    <Root>
      <Suspense fallback={<div className="h-full" />}>
        <Outlet />
      </Suspense>
    </Root>
  ),
});

const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: HomePage });

export const workspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/n/$notebookId",
  component: function Workspace() {
    const { notebookId } = workspaceRoute.useParams();
    return <WorkspacePage key={notebookId} notebookId={notebookId} />;
  },
});

export const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/$section",
  component: function Settings() {
    const { section } = settingsRoute.useParams();
    return <SettingsPage section={section} />;
  },
});

const settingsIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: () => <SettingsPage section="models" />,
});

const routeTree = rootRoute.addChildren([homeRoute, workspaceRoute, settingsRoute, settingsIndexRoute]);

export const router = createRouter({ routeTree, defaultPreload: "intent", scrollRestoration: true });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
