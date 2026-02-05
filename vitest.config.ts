import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    // Only run backend tests - web-ui tests are run separately with their own vitest config
    include: ['src/**/*.test.ts'],
    exclude: ['web-ui/**', 'e2e/**'],
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
      },
    },
  },
});
