import { fileURLToPath } from 'node:url';

import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@hevn/dapi-sdk'],
  outputFileTracingRoot: fileURLToPath(new URL('..', import.meta.url)),
  experimental: { externalDir: true },
};

export default config;
