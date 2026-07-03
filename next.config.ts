import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    'kepler.gl',
    '@kepler.gl/actions',
    '@kepler.gl/cloud-providers',
    '@kepler.gl/common-utils',
    '@kepler.gl/components',
    '@kepler.gl/constants',
    '@kepler.gl/deckgl-arrow-layers',
    '@kepler.gl/deckgl-layers',
    '@kepler.gl/effects',
    '@kepler.gl/layers',
    '@kepler.gl/localization',
    '@kepler.gl/processors',
    '@kepler.gl/reducers',
    '@kepler.gl/schemas',
    '@kepler.gl/styles',
    '@kepler.gl/table',
    '@kepler.gl/tasks',
    '@kepler.gl/types',
    '@kepler.gl/utils',
  ],
};

export default nextConfig;
