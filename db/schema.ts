import { pgTable, uuid, text, jsonb, timestamp } from "drizzle-orm/pg-core";

export const tools = pgTable("tools", {
  id: uuid("id").defaultRandom().primaryKey(),

  name: text("name").notNull(),
  description: text("description").notNull().default(""),

  code: text("code").notNull(),

  uiSchema: jsonb("ui_schema")
    .$type<{
      inputs: Array<{
        id: string;
        type: "image" | "images";
        required: boolean;
      }>;
      parameters: Array<{
        id: string;
        type: "slider" | "number" | "text" | "select" | "boolean" | "color";
        label: string;
        default?: string | number | boolean;
        min?: number;
        max?: number;
        options?: Array<{ label: string; value: string }>;
      }>;
      output: { type: "image" };
    }>()
    .notNull(),

  testReport: jsonb("test_report")
    .$type<{
      passed: boolean;
      tests?: string;
      proposal?: import("../lib/tool-contract").Proposal;
      attempts?: Array<{
        attempt: number;
        report: {
          passed: boolean;
          results: Array<{ name: string; passed: boolean; error?: string }>;
        };
      }>;
      results: Array<{
        name: string;
        passed: boolean;
        error?: string;
      }>;
    }>()
    .notNull(),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Tool = typeof tools.$inferSelect;
export type NewTool = typeof tools.$inferInsert;

// A separate namespace prevents management code from being exposed as an image tool.
export const registryCapabilities = pgTable("registry_capabilities", {
  id: text("id").primaryKey(),
  version: text("version").notNull(),
  code: text("code").notNull(),
  tests: text("tests").notNull(),
  permissions: jsonb("permissions").$type<string[]>().notNull(),
  testReport: jsonb("test_report").$type<{ passed: boolean; attempts: Array<{ attempt: number; passed: boolean; error?: string }> }>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
