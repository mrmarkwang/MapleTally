/** Next.js browser contracts with explicit fixture config; services are mocked only at the page boundary. */
import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: { baseURL: "http://127.0.0.1:4173", trace: "retain-on-failure" },
  webServer: {
    command: "npm run start -- --hostname 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173/api/health",
    reuseExistingServer: false,
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
      SUPABASE_SECRET_KEY: "test-secret-key",
      APP_ORIGIN: "http://127.0.0.1:4173",
      CRON_SECRET: "test-cron-secret",
    },
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
});
