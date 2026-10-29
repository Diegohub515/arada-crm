import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Los errores de tipos se revisan con `npm run typecheck`; no bloquean el despliegue.
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
