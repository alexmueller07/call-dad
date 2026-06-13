import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Pin the workspace root to this project. Without this, Next walks up and
  // finds a stray package-lock.json in the home directory and guesses wrong.
  turbopack: {
    root: path.resolve(),
  },
};

export default nextConfig;
