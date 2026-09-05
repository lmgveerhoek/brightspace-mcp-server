/**
 * Brightspace MCP Server
 * Copyright (c) 2026 Rohan Muppa. All rights reserved.
 * Licensed under MIT — see LICENSE file for details.
 *
 * Shared contract for institution-specific SSO flows and a factory that selects
 * the configured flow.
 */

import type { Page } from "playwright";
import type { AuthProvider } from "../types/index.js";
import { PurdueSSOFlow } from "./purdue-sso.js";
import { TudelftSSOFlow } from "./tudelft-sso.js";

/**
 * A school-specific SSO login flow. Implementations drive the browser to log in
 * and navigate the institution's identity provider (IdP).
 */
export interface SSOFlow {
  /** Whether username + password are available for automated entry. */
  hasCredentials(): boolean;

  /**
   * Whether the login flow requires the user to interact with the browser even
   * when credentials are configured (e.g. a rotating TOTP code). Forces headed
   * mode so the user can approve MFA / type a code.
   */
  requiresBrowserInteraction(): boolean;

  /** Run the automated login flow. Returns true once on /d2l/home. */
  login(page: Page): Promise<boolean>;

  /** Run the manual login flow. Returns true once on /d2l/home. */
  manualLogin(page: Page): Promise<boolean>;
}

export interface SSOFlowConfig {
  username?: string;
  password?: string;
}

/** Create the explicitly configured institution-specific SSO flow. */
export function createSSOFlow(
  provider: AuthProvider,
  config: SSOFlowConfig,
): SSOFlow {
  switch (provider) {
    case "tudelft":
      return new TudelftSSOFlow(config);
    case "purdue":
      return new PurdueSSOFlow(config);
  }
}
