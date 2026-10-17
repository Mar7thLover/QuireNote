import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { Root } from "@/components/Root";
import { HomePage } from "@/routes/home";

const WorkspacePage = lazy(() => import("@/routes/workspace").then((m) => ({ default: m.WorkspacePage })));
const SettingsPage = lazy(() => import("@/routes/settings").then((m) => ({ default: m.SettingsPage })));
const SharePage = lazy(() => import("@/features/share/SharePage").then((m) => ({ default: m.SharePage })));

const rootRoute = createRootRoute({ component: Outlet });

/** 应用本体：侧栏、服务器事件、命令面板等都挂在这里。 */
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  component: () => (
    <Root>
      <Suspense fallback={<div className="h-full" />}>
        <Outlet />
      </Suspense>
    </Root>
  ),
});

/** 分享链接的只读页：不挂应用本体，只请求公开接口。 */
export const shareRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/share/$token",
  component: function Share() {
    const { token } = shareRoute.useParams();
    return (
      <Suspense fallback={<div className="h-full" />}>
        <SharePage key={token} token={token} />
      </Suspense>
    );
  },
});

const homeRoute = createRoute({ getParentRoute: () => appRoute, path: "/", component: HomePage });

export const workspaceRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/n/$notebookId",
  /** panel：进入时打开的面板（例如首页「去复习」）；note：进入时打开的笔记（首页「最近打开」）。 */
  validateSearch: (search: Record<string, unknown>): { panel?: string; note?: string } => ({
    ...(typeof search.panel === "string" ? { panel: search.panel } : {}),
    ...(typeof search.note === "string" ? { note: search.note } : {}),
  }),
  component: function Workspace() {
    const { notebookId } = workspaceRoute.useParams();
    const { panel, note } = workspaceRoute.useSearch();
    return <WorkspacePage key={notebookId} notebookId={notebookId} initialPanel={panel} initialNote={note} />;
  },
});

export const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/settings/$section",
  component: function Settings() {
    const { section } = settingsRoute.useParams();
    return <SettingsPage section={section} />;
  },
});

const settingsIndexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/settings",
  component: () => <SettingsPage section="models" />,
});

const routeTree = rootRoute.addChildren([
  appRoute.addChildren([homeRoute, workspaceRoute, settingsRoute, settingsIndexRoute]),
  shareRoute,
]);

export const router = createRouter({ routeTree, defaultPreload: "intent", scrollRestoration: true });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
