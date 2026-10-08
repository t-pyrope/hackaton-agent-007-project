import { db } from "@/lib/db";
import { tools } from "@/db/schema";

export const runtime = "nodejs";

export async function GET() {
  try {
    const records = await db
      .select({
        id: tools.id,
        name: tools.name,
        description: tools.description,
        uiSchema: tools.uiSchema,
        testReport: tools.testReport,
        createdAt: tools.createdAt,
      })
      .from(tools);
    return Response.json(
      { tools: records },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "Could not load installed tools." },
      { status: 503 },
    );
  }
}
