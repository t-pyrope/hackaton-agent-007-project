import type { Config } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to run database migrations");
}

const databaseUrl = new URL(process.env.DATABASE_URL);
if (databaseUrl.searchParams.get("sslmode") === "require") {
  databaseUrl.searchParams.set("sslmode", "verify-full");
}

export default {
  schema: "./db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl.toString(),
  },
} satisfies Config;
