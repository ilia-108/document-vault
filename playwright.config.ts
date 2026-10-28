import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/ui',
  workers: 1,
  fullyParallel: false,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL: 'http://127.0.0.1:3041',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'MOCK_PORT=3046 yarn mock:server',
      url: 'http://127.0.0.1:3046/api/health',
      reuseExistingServer: false,
    },
    {
      command:
        'DOCUMENT_MOCK_URL=http://127.0.0.1:3046 yarn vite --host 127.0.0.1 --port 3041 --strictPort',
      url: 'http://127.0.0.1:3041',
      reuseExistingServer: false,
    },
  ],
});
