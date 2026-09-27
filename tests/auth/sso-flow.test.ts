import { describe, it, expect } from "vitest";
import { createSSOFlow } from "../../src/auth/sso-flow.js";
import { PurdueSSOFlow } from "../../src/auth/purdue-sso.js";
import { TudelftSSOFlow } from "../../src/auth/tudelft-sso.js";

describe("createSSOFlow", () => {
  it("returns the explicitly selected TU Delft flow", () => {
    const flow = createSSOFlow("tudelft", {
      username: "jdoe",
      password: "secret",
    });
    expect(flow).toBeInstanceOf(TudelftSSOFlow);
    expect(flow.hasCredentials()).toBe(true);
    // TU Delft Brightspace does not require MFA for student login.
    expect(flow.requiresBrowserInteraction()).toBe(false);
  });

  it("returns the Purdue flow when selected", () => {
    const flow = createSSOFlow("purdue", {});
    expect(flow).toBeInstanceOf(PurdueSSOFlow);
    expect(flow.requiresBrowserInteraction()).toBe(false);
  });

  it("reports no credentials when username/password are omitted", () => {
    const flow = createSSOFlow("tudelft", {});
    expect(flow.hasCredentials()).toBe(false);
    expect(flow).toBeInstanceOf(TudelftSSOFlow);
  });
});
