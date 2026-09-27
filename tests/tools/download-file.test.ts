import { describe, it, expect, vi } from "vitest";
import { registerDownloadFile } from "../../src/tools/download-file.js";
import { ApiError } from "../../src/api/errors.js";
import os from "node:os";

function setup(opts: {
  getRawImpl?: (path: string) => Promise<any>;
  getImpl?: (path: string) => Promise<any>;
}) {
  const apiClient = {
    le: (_org: number, p: string) => `/d2l/api/le/1.0${p}`,
    getRaw: vi.fn(opts.getRawImpl || (async () => {
      throw new ApiError(403, "/path", "Forbidden");
    })),
    get: vi.fn(opts.getImpl || (async () => {
      return null;
    })),
  };

  let handler: (args: unknown) => Promise<any>;
  const server = {
    registerTool: (_name: string, _meta: unknown, fn: (args: unknown) => Promise<any>) => {
      handler = fn;
    },
  };

  registerDownloadFile(server as any, apiClient as any);
  return { call: (args: unknown) => handler!(args), apiClient };
}

describe("download_file unreleased/unavailable content handling", () => {
  const downloadPath = os.tmpdir();

  it("gracefully informs when a topic has a future release start date", async () => {
    const { call } = setup({
      getRawImpl: async () => {
        throw new ApiError(403, "/file", "Forbidden");
      },
      getImpl: async (path: string) => {
        if (path.includes("/content/topics/102")) {
          return {
            Id: 102,
            Title: "Lecture 2 - Future Release.pdf",
            StartDate: "2099-01-01T09:00:00.000Z",
            IsLocked: false,
            IsHidden: false,
          };
        }
        return null;
      },
    });

    const result = await call({
      courseId: 12345,
      topicId: 102,
      downloadPath,
    });

    expect(result.isError).toBeUndefined(); // tool execution succeeded without throwing an MCP error
    const data = JSON.parse(result.content[0].text);
    expect(data.success).toBe(false);
    expect(data.available).toBe(false);
    expect(data.reason).toBe("not_yet_open");
    expect(data.title).toBe("Lecture 2 - Future Release.pdf");
    expect(data.message).toContain("is aanwezig op Brightspace, maar is nog niet beschikbaar gesteld door de docent");
  });

  it("gracefully informs when a topic is locked by the instructor", async () => {
    const { call } = setup({
      getRawImpl: async () => {
        throw new ApiError(403, "/file", "Forbidden");
      },
      getImpl: async (path: string) => {
        if (path.includes("/content/topics/103")) {
          return {
            Id: 103,
            Title: "Exam Prep.pdf",
            StartDate: null,
            IsLocked: true,
            IsHidden: false,
          };
        }
        return null;
      },
    });

    const result = await call({
      courseId: 12345,
      topicId: 103,
      downloadPath,
    });

    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0].text);
    expect(data.success).toBe(false);
    expect(data.available).toBe(false);
    expect(data.reason).toBe("locked");
    expect(data.message).toContain("momenteel vergrendeld door de docent");
  });

  it("gracefully informs when topic access is completely forbidden (403 on metadata too)", async () => {
    const { call } = setup({
      getRawImpl: async () => {
        throw new ApiError(403, "/file", "Forbidden");
      },
      getImpl: async () => {
        throw new ApiError(403, "/topic", "Forbidden");
      },
    });

    const result = await call({
      courseId: 12345,
      topicId: 104,
      downloadPath,
    });

    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0].text);
    expect(data.success).toBe(false);
    expect(data.available).toBe(false);
    expect(data.reason).toBe("restricted");
    expect(data.message).toContain("nog niet beschikbaar gesteld door de docent");
  });
});
