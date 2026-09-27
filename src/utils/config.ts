/**
 * Brightspace MCP Server
 * Copyright (c) 2026 Rohan Muppa. All rights reserved.
 * Licensed under MIT — see LICENSE file for details.
 */

import * as path from "node:path";
import * as os from "node:os";
import type { AppConfig, AuthProvider } from "../types/index.js";
import { configStoreExists, loadConfigStore } from "./config-store.js";

export function loadConfig(): AppConfig {
  let store: ReturnType<typeof loadConfigStore> | null = null;
  try {
    store = configStoreExists() ? loadConfigStore() : null;
  } catch {
    store = null;
  }

  if (store) {
    console.error("[config] Loaded base config from ~/.brightspace-mcp/config.json");
  } else {
    console.error("[config] No config.json found or unreadable, using environment variables");
  }

  // Resolve sessionDir: env > store > default
  const sessionDir = process.env.D2L_SESSION_DIR
    ? expandTilde(process.env.D2L_SESSION_DIR)
    : store?.sessionDir
      ? expandTilde(store.sessionDir)
      : path.join(os.homedir(), ".d2l-session");

  const username = process.env.D2L_USERNAME || store?.username;
  const password = process.env.D2L_PASSWORD || store?.password;

  // Resolve headless: env > store > default (true when credentials exist, false for manual login)
  let headless = Boolean(username && password);
  if (store?.headless !== undefined) {
    headless = store.headless;
  }
  if (process.env.D2L_HEADLESS !== undefined) {
    headless = process.env.D2L_HEADLESS === "true";
  }

  // Resolve tokenTtl: env > store > default (3600)
  const tokenTtl = process.env.D2L_TOKEN_TTL
    ? parseInt(process.env.D2L_TOKEN_TTL, 10)
    : store?.tokenTtl ?? 3600;

  // Resolve includeCourseIds: env > store > undefined
  const includeCourseIds = process.env.D2L_INCLUDE_COURSES
    ? process.env.D2L_INCLUDE_COURSES.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n))
    : store?.includeCourses;

  // Resolve excludeCourseIds: env > store > undefined
  const excludeCourseIds = process.env.D2L_EXCLUDE_COURSES
    ? process.env.D2L_EXCLUDE_COURSES.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n))
    : store?.excludeCourses;

  // Resolve activeOnly: env > store > default (true)
  let activeOnly = store?.activeOnly ?? true;
  if (process.env.D2L_ACTIVE_ONLY !== undefined) {
    activeOnly = process.env.D2L_ACTIVE_ONLY !== 'false';
  }

  const authProvider = process.env.D2L_AUTH_PROVIDER || store?.authProvider || "purdue";
  if (!isAuthProvider(authProvider)) {
    throw new Error(
      `Invalid D2L_AUTH_PROVIDER: ${authProvider}. Expected "purdue" or "tudelft".`,
    );
  }

  return {
    baseUrl: process.env.D2L_BASE_URL || store?.baseUrl || "https://purdue.brightspace.com",
    authProvider,
    sessionDir,
    tokenTtl,
    headless,
    username,
    password,
    courseFilter: {
      includeCourseIds,
      excludeCourseIds,
      activeOnly,
    },
  };
}

function isAuthProvider(value: string): value is AuthProvider {
  return value === "purdue" || value === "tudelft";
}

function expandTilde(filePath: string): string {
  if (filePath.startsWith("~")) {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return filePath;
}

export type { AppConfig };
