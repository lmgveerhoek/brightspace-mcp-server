import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock config-store so tests don't read ~/.brightspace-mcp/config.json from host disk
vi.mock("../../src/utils/config-store.js", () => ({
  configStoreExists: vi.fn(() => false),
  loadConfigStore: vi.fn(() => null),
  saveConfigStore: vi.fn(),
  getConfigStorePath: vi.fn(() => "/mock/path"),
}));

import { loadConfig } from "../../src/utils/config.js";
import * as configStore from "../../src/utils/config-store.js";

describe("loadConfig headless default resolution", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.D2L_HEADLESS;
    delete process.env.D2L_USERNAME;
    delete process.env.D2L_PASSWORD;
    vi.mocked(configStore.configStoreExists).mockReturnValue(false);
    vi.mocked(configStore.loadConfigStore).mockReturnValue(null as any);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("defaults headless to false when no credentials are present", () => {
    const config = loadConfig();
    expect(config.headless).toBe(false);
  });

  it("defaults headless to true when credentials are present in env", () => {
    process.env.D2L_USERNAME = "netid";
    process.env.D2L_PASSWORD = "secretpassword";
    const config = loadConfig();
    expect(config.headless).toBe(true);
  });

  it("defaults headless to true when credentials are in config store", () => {
    vi.mocked(configStore.configStoreExists).mockReturnValue(true);
    vi.mocked(configStore.loadConfigStore).mockReturnValue({
      username: "storeuser",
      password: "storepassword",
    });
    const config = loadConfig();
    expect(config.headless).toBe(true);
  });

  it("honors headless: false in config store", () => {
    vi.mocked(configStore.configStoreExists).mockReturnValue(true);
    vi.mocked(configStore.loadConfigStore).mockReturnValue({
      username: "storeuser",
      password: "storepassword",
      headless: false,
    });
    const config = loadConfig();
    expect(config.headless).toBe(false);
  });

  it("allows D2L_HEADLESS=false to override default when credentials are present", () => {
    process.env.D2L_USERNAME = "netid";
    process.env.D2L_PASSWORD = "secretpassword";
    process.env.D2L_HEADLESS = "false";
    const config = loadConfig();
    expect(config.headless).toBe(false);
  });

  it("allows D2L_HEADLESS=true even when no credentials are in env", () => {
    process.env.D2L_HEADLESS = "true";
    const config = loadConfig();
    expect(config.headless).toBe(true);
  });
});
