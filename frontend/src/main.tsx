import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { loadProfile } from "./profile";
import { InstantTooltip } from "./InstantTooltip";
import { ProfileSaveStatus } from "./ProfileSaveStatus";
import "./styles.css";
import { retryQuery } from "./queryPolicy";

const client = new QueryClient({
  defaultOptions: {
    queries: {
      retry: retryQuery,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30_000),
      staleTime: 2000,
      refetchOnWindowFocus: true,
    },
  },
});
void loadProfile().then(() => {
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={client}>
      <App />
      <InstantTooltip />
      <ProfileSaveStatus />
    </QueryClientProvider>
  </React.StrictMode>,
);

});
