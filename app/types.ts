import type { Tool as DatabaseTool } from "@/db/schema";
export type Tool = Omit<DatabaseTool, "code" | "createdAt"> & {
  createdAt: string;
};
