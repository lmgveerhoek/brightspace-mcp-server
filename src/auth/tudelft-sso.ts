/**
 * Brightspace MCP Server
 * Copyright (c) 2026 Rohan Muppa. All rights reserved.
 * Licensed under MIT — see LICENSE file for details.
 *
 * TU Delft SSO flow.
 *
 * brightspace.tudelft.nl routes through SURFconext and the TU Delft identity
 * provider (login.tudelft.nl, a SimpleSAMLphp deployment):
 *
 *   1. /d2l/login -> /d2l/lp/auth/saml/initiate-login?entityId=<surfconext-sp>
 *   2. SURFconext (engine.surfconext.nl) proxies to login.tudelft.nl
 *   3. TU Delft IdP shows the NetID + password form (#username / #password /
 *      #submit_button)
 *   4. Optional 2FA: a rotating code from the Microsoft Authenticator app
 *      ("login.tudelft.nl" profile)
 *   5. Optional one-time consent ("share your information with our SSO provider")
 *   6. SURFconext asserts back to Brightspace -> /d2l/home
 *
 * The TOTP code cannot be automated (the user must read it off their phone), so
 * the browser must remain visible (headed). This flow auto-fills credentials and
 * then lets the user type the code and confirm any consent screen.
 */

import type { Page } from "playwright";
import { BrowserAuthError } from "../utils/errors.js";
import { log } from "../utils/logger.js";
import type { SSOFlow, SSOFlowConfig } from "./sso-flow.js";

const MFA_SELECTORS = [
  "input#otp",
  "input#code",
  "input#totp",
  "input[name*='code' i]",
  "input[name*='otp' i]",
  "input[inputmode='numeric']",
  "input[type='tel']",
  "input[placeholder*='code' i]",
  "input[placeholder*='authentication' i]",
  "input[placeholder*='6-digit' i]",
] as const;

const INSTITUTION_SELECTORS = [
  'a:has-text("TU Delft")',
  'a:has-text("Delft")',
  'button:has-text("TU Delft")',
  'button:has-text("Delft")',
  'input[type="submit"][value*="Delft"]',
] as const;

const CONSENT_SELECTORS = [
  "#yes",
  "button[name='yes']",
  "input[type='submit'][name='yes']",
  "input[type='submit'][value*='yes' i]",
  "button:has-text('Yes, continue')",
  "button:has-text('Continue')",
  "button:has-text('Accept')",
  "button:has-text('Agree')",
  "input[type='submit'][value*='continue' i]",
] as const;

export class TudelftSSOFlow implements SSOFlow {
  private config: SSOFlowConfig;
  private credentialsSubmitted = false;
  private mfaHintLogged = false;
  private manualHintLogged = false;

  constructor(config: SSOFlowConfig) {
    this.config = config;
  }

  /** Returns true if NetID + password are available for automated entry. */
  hasCredentials(): boolean {
    return Boolean(this.config.username && this.config.password);
  }

  /**
   * TU Delft Brightspace does not require MFA/2FA, so when NetID credentials
   * are provided, the login flow can run headlessly without browser interaction.
   */
  requiresBrowserInteraction(): boolean {
    return false;
  }

  /**
   * Execute the complete SURFconext + TU Delft IdP login flow.
   *
   * @param page - Playwright page already navigated into the SAML flow
   * @returns true on successful login (URL contains /d2l/home)
   */
  async login(page: Page): Promise<boolean> {
    try {
      log("INFO", "Starting TU Delft SSO login flow");

      this.resetState();

      // The browser must stay open for the TOTP code the user enters from
      // their Microsoft Authenticator app.
      const ok = await this.runToHome(page, 300000);
      if (ok) {
        log("INFO", "Login successful - reached Brightspace home");
      }
      return ok;
    } catch (error) {
      log("ERROR", "TU Delft SSO login flow failed", error);
      return false;
    }
  }

  /**
   * Manual login fallback: let the user sign in and approve MFA themselves.
   * The browser stays open in headed mode while we wait for /d2l/home.
   */
  async manualLogin(page: Page): Promise<boolean> {
    try {
      log("INFO", "Manual login: sign in with your TU Delft NetID, then approve MFA in the browser window.");
      log("INFO", "Waiting up to 5 minutes for you to complete login and MFA...");

      this.resetState();

      const ok = await this.runToHome(page, 300000);
      if (ok) {
        log("INFO", "Manual login successful - reached Brightspace home");
      }
      return ok;
    } catch (error) {
      log("ERROR", "Manual login flow failed or timed out", error);
      return false;
    }
  }

  private resetState(): void {
    this.credentialsSubmitted = false;
    this.mfaHintLogged = false;
    this.manualHintLogged = false;
  }

  /**
   * Poll the page until we land on Brightspace home, advancing the
   * SURFconext / TU Delft IdP pages as far as we safely can.
   */
  private async runToHome(page: Page, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const url = page.url();

      if (/\/d2l\/home/.test(url)) {
        return true;
      }

      // Only try to drive the flow while on an auth domain; let the SAML
      // redirects at Brightspace/SURFconext proceed on their own.
      if (/login\.tudelft\.nl|surfconext|engine\.surfconext/i.test(url)) {
        try {
          await this.tryAdvance(page);
        } catch (error) {
          // Transient errors happen during page navigation (execution
          // context destroyed, etc.). Ignore and keep polling.
          log("DEBUG", "Transient page error during auth navigation", error);
        }
      }

      // Poll faster while waiting to enter credentials so login starts immediately
      await page.waitForTimeout(this.credentialsSubmitted ? 750 : 200);
    }

    throw new BrowserAuthError(
      `TU Delft login timed out after ${Math.round(timeoutMs / 1000)}s`,
      "tudelft_login_timeout"
    );
  }

  /**
   * Attempt one "step" of the flow. Order matters: we must never click a
   * consent/continue button while the MFA code input is on screen, so MFA is
   * detected before consent.
   */
  private async tryAdvance(page: Page): Promise<void> {
    // 1. NetID + password form
    if (!this.credentialsSubmitted && (await page.$("input#username"))) {
      await this.fillLoginForm(page);
      return;
    }

    // 2. SURFconext institution chooser (defensive - usually auto-selected)
    if (await this.clickInstitution(page)) {
      return;
    }

    // 3. MFA code prompt - hand over to the user, never auto-advance.
    if (await this.hintMfa(page)) {
      return;
    }

    // 4. One-time consent / continue screen
    await this.clickConsent(page);
  }

  private async fillLoginForm(page: Page): Promise<void> {
    if (!this.config.username || !this.config.password) {
      if (!this.manualHintLogged) {
        log("INFO", "Enter your NetID and password in the browser window.");
        this.manualHintLogged = true;
      }
      return;
    }

    try {
      await page.fill("input#username", this.config.username);
      await page.waitForSelector("input#password", { timeout: 10000 });
      await page.fill("input#password", this.config.password);
      await page.waitForSelector("#submit_button", { timeout: 10000 });
      await page.click("#submit_button");
      this.credentialsSubmitted = true;
      log("INFO", "NetID credentials submitted - logging into Brightspace...");
    } catch (error) {
      log("WARN", "Automated credential entry failed, falling back to manual login", error);
      // Leave the form open so the user can type their credentials.
    }
  }

  private async clickInstitution(page: Page): Promise<boolean> {
    for (const selector of INSTITUTION_SELECTORS) {
      const el = await page.$(selector);
      if (el) {
        log("INFO", "Selecting TU Delft on the institution chooser");
        await el.click();
        return true;
      }
    }
    return false;
  }

  /**
   * If an MFA code field is visible, log guidance once and stop - the user must
   * type their rotating authenticator code, and we must not click a button on
   * their behalf while a code is expected.
   */
  private async hintMfa(page: Page): Promise<boolean> {
    for (const selector of MFA_SELECTORS) {
      const el = await page.$(selector);
      if (el) {
        if (!this.mfaHintLogged) {
          log("INFO", "MFA required: enter the 6-digit code from the 'login.tudelft.nl' profile in your Microsoft Authenticator app.");
          this.mfaHintLogged = true;
        }
        return true;
      }
    }
    return false;
  }

  private async clickConsent(page: Page): Promise<boolean> {
    for (const selector of CONSENT_SELECTORS) {
      const el = await page.$(selector);
      if (el) {
        log("INFO", "Accepting the SSO consent / continue screen");
        await el.click();
        return true;
      }
    }
    return false;
  }
}
