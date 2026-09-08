import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { loadProfile } from "./profile";
import { InstantTooltip } from "./InstantTooltip";
import "./styles.css";

const client = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 3,
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
    </QueryClientProvider>
  </React.StrictMode>,
);

});
