import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    optimizePackageImports: ['lucide-react', 'recharts', '@tanstack/react-table'],
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.supabase.co',
      },
    ],
  },
  async headers() {
    return [
      {
        // Static geojson re-downloaded on every map mount without this.
        source: '/tam/us-states.geojson',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=86400, immutable' },
        ],
      },
    ];
  },
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
