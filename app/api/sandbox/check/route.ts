import { checkSandboxConnection } from "@/lib/sandbox";

export const runtime = "nodejs";

export async function GET() {
  if (process.env.NODE_ENV !== "development")
    return new Response(null, { status: 404 });
  try {
    return Response.json(await checkSandboxConnection(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      {
        error:
          "Sandbox connection failed. Refresh VERCEL_OIDC_TOKEN with vercel env pull.",
      },
      { status: 503 },
    );
  }
}
