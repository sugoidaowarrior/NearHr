import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* Keep native Node addons (SQLite bindings, SIP's yellowstone gRPC .node
     addon) out of the bundle — they can't be inlined into webpack/turbopack
     chunks, so Next loads them via require() at runtime on the Node server. */
  serverExternalPackages: [
    "better-sqlite3",
    "@triton-one/yellowstone-grpc",
    "@triton-one/yellowstone-grpc-napi-darwin-arm64",
  ],
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
