import { describe, it, expect, beforeEach, vi } from "vitest";
import { BrowserAuth } from "../../src/auth/browser-auth.js";
import type { AppConfig } from "../../src/types/index.js";

/**
 * Regression tests for navigateAndLogin()'s already-authenticated detection.
 *
 * Some institutions (USC, for example) redirect through an intermediate SAML hop
 * such as /d2l/lp/auth/login/samlLogin.d2l before landing on /d2l/home, even when
 * the restored cookies are still valid. page.goto(..., { waitUntil:
 * "domcontentloaded" }) can resolve while the URL is still that intermediate hop,
 * so reading page.url() immediately afterwards misreports a live session as
 * logged-out and kicks off an SSO flow that waits forever for a login form.
 */

const BASE_URL = "https://brightspace.example.edu";

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    baseUrl: BASE_URL,
    authProvider: "purdue",
    sessionDir: "/tmp/does-not-matter",
    tokenTtl: 3600,
    headless: true,
    username: "student@example.edu",
    password: "hunter2",
    courseFilter: {} as AppConfig["courseFilter"],
    ...overrides,
  };
}

/**
 * Fake Page that reproduces a multi-hop redirect: goto() settles on the SAML hop
 * and only a subsequent waitForURL() observes the final /d2l/home landing.
 */
function makeRedirectingPage(hops: string[]) {
  let current = hops[0];
  let index = 0;
  return {
    goto: vi.fn(async () => {
      current = hops[0];
      return null;
    }),
    url: vi.fn(() => current),
    waitForURL: vi.fn(async (predicate: RegExp | ((url: URL) => boolean)) => {
      while (index < hops.length - 1) {
        index += 1;
        current = hops[index];
        const matches =
          predicate instanceof RegExp
            ? predicate.test(current)
            : predicate(new URL(current));
        if (matches) return;
      }
      throw new Error("Timeout waiting for URL");
    }),
    waitForLoadState: vi.fn(async () => {}),
  };
}

describe("BrowserAuth.navigateAndLogin", () => {
  let auth: BrowserAuth;
  let ssoFlow: { login: ReturnType<typeof vi.fn>; manualLogin: ReturnType<typeof vi.fn>; hasCredentials: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    auth = new BrowserAuth(makeConfig());
    ssoFlow = {
      login: vi.fn(async () => true),
      manualLogin: vi.fn(async () => true),
      hasCredentials: vi.fn(() => true),
    };
    // navigateAndLogin is private; swap the SSO flow so we can assert it stays unused.
    (auth as any).ssoFlow = ssoFlow;
  });

  const navigate = (page: unknown): Promise<boolean> =>
    (auth as any).navigateAndLogin(page);

  it("treats a valid session as authenticated when goto settles on an intermediate SAML hop", async () => {
    const page = makeRedirectingPage([
      `${BASE_URL}/d2l/lp/auth/login/samlLogin.d2l`,
      `${BASE_URL}/d2l/home`,
    ]);

    await expect(navigate(page)).resolves.toBe(true);
    expect(ssoFlow.login).not.toHaveBeenCalled();
    expect(ssoFlow.manualLogin).not.toHaveBeenCalled();
  });

  it("still performs SSO login when the redirect chain never reaches /d2l/home", async () => {
    const page = makeRedirectingPage([
      `${BASE_URL}/d2l/lp/auth/login/login.d2l`,
      "https://sso.example.edu/idp/profile/SAML2/Redirect/SSO",
    ]);

    await expect(navigate(page)).resolves.toBe(false);
    expect(ssoFlow.login).toHaveBeenCalledOnce();
  });

  it("short-circuits without waiting when goto already lands on /d2l/home", async () => {
    const page = makeRedirectingPage([`${BASE_URL}/d2l/home`]);

    await expect(navigate(page)).resolves.toBe(true);
    expect(page.waitForURL).not.toHaveBeenCalled();
    expect(ssoFlow.login).not.toHaveBeenCalled();
  });

  it("immediately starts SSO login without waiting when landing directly on a known auth URL", async () => {
    const page = makeRedirectingPage([`${BASE_URL}/d2l/login?sessionExpired=0`]);

    await expect(navigate(page)).resolves.toBe(false);
    expect(page.waitForURL).not.toHaveBeenCalled();
    expect(ssoFlow.login).toHaveBeenCalledOnce();
  });

  it("detects Brightspace client-side redirect shell on /d2l/home and advances to login", async () => {
    let current = `${BASE_URL}/d2l/home`;
    const page = {
      goto: vi.fn(async () => null),
      url: vi.fn(() => current),
      evaluate: vi.fn(async () => true), // mock isRedirectShell = true
      waitForURL: vi.fn(async (predicate: (url: URL) => boolean) => {
        current = `${BASE_URL}/d2l/login?sessionExpired=0`;
        if (predicate(new URL(current))) return;
        throw new Error("Timeout");
      }),
      waitForLoadState: vi.fn(async () => {}),
    };

    await expect(navigate(page)).resolves.toBe(false);
    expect(page.evaluate).toHaveBeenCalledOnce();
    expect(ssoFlow.login).toHaveBeenCalledOnce();
  });
});
