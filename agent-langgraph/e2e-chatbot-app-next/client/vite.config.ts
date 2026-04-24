import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import type { ProxyOptions } from "vite";

export function simulateNetworkError(
  _timeout: number,
): ProxyOptions["configure"] {
  return (proxy, _options) => {
    proxy.on("proxyReq", (proxyReq, _req, res) => {
      setTimeout(() => {
        // Destroy the socket connection to the browser
        res.socket?.destroy(new Error("simulated network error"));

        // Also clean up the backend connection
        proxyReq.socket?.destroy();
      }, 2000);
    });
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname, ".."), "");
  const backendPort =
    env.CHAT_APP_SERVER_PORT || env.CHAT_APP_PORT || process.env.CHAT_APP_SERVER_PORT || process.env.CHAT_APP_PORT || "3001";
  const clientPort =
    env.CHAT_APP_CLIENT_PORT || process.env.CHAT_APP_CLIENT_PORT || process.env.PORT || "3002";
  const proxyTarget =
    env.BACKEND_URL || process.env.BACKEND_URL || `http://localhost:${backendPort}`;

  return {
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      port: Number.parseInt(clientPort, 10),
      proxy: {
        "/api/chat": {
          target: proxyTarget,
          changeOrigin: true,
          // Uncomment this to test situations where the stream will time out.
          // configure: simulateNetworkError(2000),
        },
        "/api": {
          target: proxyTarget,
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: "dist",
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) return;
            const [, modulePath] = id.split("node_modules/");
            if (!modulePath) return;

            if (
              modulePath.startsWith("react/") ||
              modulePath === "react" ||
              modulePath.startsWith("react-dom/") ||
              modulePath === "react-dom" ||
              modulePath.startsWith("react-router") ||
              modulePath.startsWith("scheduler")
            ) {
              return "react-core";
            }

            if (
              modulePath.startsWith("@ai-sdk/") ||
              modulePath === "ai" ||
              modulePath.startsWith("ai/") ||
              modulePath.startsWith("swr")
            ) {
              return "vendor-ai";
            }

            if (modulePath.startsWith("@radix-ui/")) {
              return "vendor-radix";
            }

            if (modulePath.startsWith("framer-motion")) {
              return "vendor-motion";
            }

            if (modulePath.startsWith("lucide-react")) {
              return "vendor-icons";
            }

            if (
              modulePath.startsWith("next-themes") ||
              modulePath.startsWith("usehooks-ts") ||
              modulePath.startsWith("use-stick-to-bottom") ||
              modulePath.startsWith("sonner") ||
              modulePath.startsWith("date-fns") ||
              modulePath.startsWith("fast-deep-equal")
            ) {
              return "vendor-utils";
            }

            if (
              modulePath.startsWith("streamdown") ||
              modulePath.startsWith("mermaid") ||
              modulePath.startsWith("katex") ||
              modulePath.startsWith("shiki") ||
              modulePath.startsWith("rehype-") ||
              modulePath.startsWith("remark-") ||
              modulePath.startsWith("unified") ||
              modulePath.startsWith("micromark") ||
              modulePath.startsWith("mdast-util-") ||
              modulePath.startsWith("hast-") ||
              modulePath.startsWith("unist-") ||
              modulePath.startsWith("vfile") ||
              modulePath.startsWith("decode-named-character-reference") ||
              modulePath.startsWith("property-information") ||
              modulePath.startsWith("space-separated-tokens") ||
              modulePath.startsWith("comma-separated-tokens") ||
              modulePath.startsWith("html-url-attributes") ||
              modulePath.startsWith("hast-util-") ||
              modulePath.startsWith("mdurl") ||
              modulePath.startsWith("bail") ||
              modulePath.startsWith("trough") ||
              modulePath.startsWith("zwitch") ||
              modulePath.startsWith("ccount") ||
              modulePath.startsWith("remend")
            ) {
              return "vendor-markdown";
            }
          },
        },
      },
    },
  };
});
