import "server-only";
import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import * as schema from "@/db/schema";

// Interactive transactions (including the build lock) require the WebSocket driver.
neonConfig.webSocketConstructor = ws;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 10_000,
  max: 5,
});
export const db = drizzle(pool, { schema });
