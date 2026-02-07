import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  serverExternalPackages: ["better-sqlite3", "@agentclientprotocol/sdk", "@zed-industries/claude-code-acp"],
};

export default nextConfig;
