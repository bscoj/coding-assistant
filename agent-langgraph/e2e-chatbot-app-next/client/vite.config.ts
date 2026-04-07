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
    },
  };
});
