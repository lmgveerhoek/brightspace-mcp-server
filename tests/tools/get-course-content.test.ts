import { describe, it, expect, vi } from "vitest";
import { registerGetCourseContent } from "../../src/tools/get-course-content.js";

function setup() {
  const contentTreeData = [
    {
      Id: 100,
      Title: "Module 1 - Available",
      ShortTitle: null,
      Type: 0, // Module
      Description: { Text: "Normal module", Html: "<p>Normal module</p>" },
      ModuleStartDate: null,
      ModuleEndDate: null,
      ModuleDueDate: null,
      IsHidden: false,
      IsLocked: false,
      LastModifiedDate: null,
    },
    {
      Id: 200,
      Title: "Module 2 - Locked by instructor",
      ShortTitle: null,
      Type: 0,
      Description: null,
      ModuleStartDate: null,
      ModuleEndDate: null,
      ModuleDueDate: null,
      IsHidden: false,
      IsLocked: true,
      LastModifiedDate: null,
    },
  ];

  const module1Children = [
    {
      Id: 101,
      Title: "Lecture 1 Slides.pdf",
      ShortTitle: null,
      Type: 1, // Topic
      TopicType: 1, // File
      Description: null,
      IsHidden: false,
      IsLocked: false,
      StartDate: null,
      EndDate: null,
      DueDate: null,
      LastModifiedDate: null,
    },
    {
      Id: 102,
      Title: "Lecture 2 - Future Release.pdf",
      ShortTitle: null,
      Type: 1,
      TopicType: 1,
      Description: null,
      IsHidden: false,
      IsLocked: false,
      StartDate: "2099-01-01T09:00:00.000Z",
      EndDate: null,
      DueDate: null,
      LastModifiedDate: null,
    },
    {
      Id: 103,
      Title: "Exam Prep - Locked.pdf",
      ShortTitle: null,
      Type: 1,
      TopicType: 1,
      Description: null,
      IsHidden: false,
      IsLocked: true,
      StartDate: null,
      EndDate: null,
      DueDate: null,
      LastModifiedDate: null,
    },
  ];

  const apiClient = {
    le: (_org: number, p: string) => `/d2l/api/le/1.0${p}`,
    get: vi.fn(async (path: string) => {
      if (path.includes("/content/root/")) {
        return contentTreeData;
      }
      if (path.includes("/content/modules/100/structure/")) {
        return module1Children;
      }
      if (path.includes("/content/modules/200/structure/")) {
        return [];
      }
      if (path.includes("/content/userprogress/")) {
        return [];
      }
      return [];
    }),
  };

  let handler: (args: unknown) => Promise<any>;
  const server = {
    registerTool: (_name: string, _meta: unknown, fn: (args: unknown) => Promise<any>) => {
      handler = fn;
    },
  };

  registerGetCourseContent(server as any, apiClient as any);
  return { call: (args: unknown) => handler!(args) };
}

describe("get_course_content availability tracking", () => {
  it("marks normal topics as available", async () => {
    const { call } = setup();
    const result = await call({ courseId: 12345 });
    const parsed = JSON.parse(result.content[0].text);

    const module1 = parsed.contentTree.find((m: any) => m.id === 100);
    expect(module1).toBeDefined();
    expect(module1.isAvailable).toBe(true);
    expect(module1.availabilityStatus).toBe("available");

    const normalTopic = module1.children.find((t: any) => t.id === 101);
    expect(normalTopic).toBeDefined();
    expect(normalTopic.isAvailable).toBe(true);
    expect(normalTopic.availabilityStatus).toBe("available");
  });

  it("marks future start date topics as not_yet_open with informative message", async () => {
    const { call } = setup();
    const result = await call({ courseId: 12345 });
    const parsed = JSON.parse(result.content[0].text);

    const module1 = parsed.contentTree.find((m: any) => m.id === 100);
    const futureTopic = module1.children.find((t: any) => t.id === 102);
    expect(futureTopic).toBeDefined();
    expect(futureTopic.isAvailable).toBe(false);
    expect(futureTopic.availabilityStatus).toBe("not_yet_open");
    expect(futureTopic.availabilityMessage).toContain("Nog niet beschikbaar gesteld door de docent");
    expect(futureTopic.startDate).toBe("2099-01-01T09:00:00.000Z");
  });

  it("marks locked topics as locked with informative message", async () => {
    const { call } = setup();
    const result = await call({ courseId: 12345 });
    const parsed = JSON.parse(result.content[0].text);

    const module1 = parsed.contentTree.find((m: any) => m.id === 100);
    const lockedTopic = module1.children.find((t: any) => t.id === 103);
    expect(lockedTopic).toBeDefined();
    expect(lockedTopic.isAvailable).toBe(false);
    expect(lockedTopic.availabilityStatus).toBe("locked");
    expect(lockedTopic.availabilityMessage).toBe("Vergrendeld door docent");
  });

  it("marks locked modules as locked", async () => {
    const { call } = setup();
    const result = await call({ courseId: 12345 });
    const parsed = JSON.parse(result.content[0].text);

    const module2 = parsed.contentTree.find((m: any) => m.id === 200);
    expect(module2).toBeDefined();
    expect(module2.isAvailable).toBe(false);
    expect(module2.availabilityStatus).toBe("locked");
  });
});
