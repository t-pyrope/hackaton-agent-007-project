import { compressPng, MAX_FILE_BYTES, PngError } from "@/lib/image-tools/compress-png";

export const runtime = "nodejs";
const MAX_REQUEST_BYTES = MAX_FILE_BYTES + 64 * 1024;

export async function POST(request: Request) {
  try {
    if (!request.headers.get("content-type")?.startsWith("multipart/form-data"))
      throw new PngError("Upload one PNG using multipart form data.");
    if (Number(request.headers.get("content-length")) > MAX_REQUEST_BYTES)
      throw new PngError("PNG files must be 10 MB or smaller.", 413);
    // Bound actual bytes too, including requests without Content-Length.
    const reader = request.body?.getReader();
    if (!reader) throw new PngError("Please upload one PNG file.");
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new PngError("PNG files must be 10 MB or smaller.", 413);
      }
      chunks.push(value);
    }
    const form = await new Response(Buffer.concat(chunks), { headers: { "content-type": request.headers.get("content-type")! } }).formData();
    const files = [...form.values()].filter((value) => value instanceof File);
    const file = form.get("file");
    if (!(file instanceof File) || files.length !== 1 || form.getAll("file").length !== 1)
      throw new PngError("Please upload exactly one static PNG file.");
    const mode = form.get("mode");
    if (mode !== "lossless" && mode !== "smaller") throw new PngError("Choose Lossless or Smaller File.");
    const quality = mode === "smaller" ? Number(form.get("quality") ?? 80) : 80;
    const result = await compressPng(Buffer.from(await file.arrayBuffer()), mode, quality);
    return new Response(new Uint8Array(result.output), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
        "X-Original-Size": String(result.originalSize),
        "X-Output-Size": String(result.outputSize),
        "X-No-Reduction": String(result.noReduction),
        "X-Image-Width": String(result.width),
        "X-Image-Height": String(result.height),
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof PngError ? error.message : "Invalid upload. Please upload one static PNG file." }, {
      status: error instanceof PngError ? error.status : 400,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
