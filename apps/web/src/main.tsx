import "./styles.css";
import "./i18n";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { persister, queryClient } from "./lib/query";
import { router } from "./router";
import { initTheme } from "./stores/theme";

initTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      // 接口数据结构变化时递增 buster，丢弃旧的离线缓存（v2：提供方新增 models / headerNames）。
      persistOptions={{ persister, maxAge: 1000 * 60 * 60 * 24 * 7, buster: "v2" }}
      onSuccess={() => queryClient.resumePausedMutations()}
    >
      <RouterProvider router={router} />
    </PersistQueryClientProvider>
  </StrictMode>,
);
