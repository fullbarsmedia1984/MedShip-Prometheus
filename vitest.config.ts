import path from 'node:path'

// Plain-object config (no 'vitest/config' import): vitest is invoked via
// `npx vitest run` in this repo rather than installed as a devDependency,
// so the config must not require the vitest package to resolve locally.
export default {
  resolve: {
    alias: {
      // Next.js server-bundle marker throws outside Next; no-op it in tests.
      'server-only': path.resolve(__dirname, 'src/test/stubs/server-only.ts'),
      // Match tsconfig "@/*" -> "./src/*"
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
  },
}
