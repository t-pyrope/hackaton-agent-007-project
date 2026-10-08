import sharp from "sharp";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_PIXELS = 25_000_000;
export type CompressionMode = "lossless" | "smaller";
export class PngError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

// Read chunks as well as Sharp metadata: some decoders expose only APNG's default image.
function validateChunks(input: Buffer) {
  if (!input.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    throw new PngError("Please upload a valid PNG file.");
  let offset = 8;
  let first = true;
  while (offset + 12 <= input.length) {
    const length = input.readUInt32BE(offset);
    if (offset + length + 12 > input.length) break;
    const type = input.toString("ascii", offset + 4, offset + 8);
    if (first && (type !== "IHDR" || length !== 13)) break;
    if (first) {
      const width = input.readUInt32BE(offset + 8);
      const height = input.readUInt32BE(offset + 12);
      if (!width || !height) throw new PngError("Please upload a valid PNG file.");
      if (width * height > MAX_PIXELS) throw new PngError("PNG images must contain no more than 25 MP.", 413);
    }
    first = false;
    if (["acTL", "fcTL", "fdAT"].includes(type))
      throw new PngError("Animated PNG files are not supported. Please upload one static PNG.");
    offset += length + 12;
    if (type === "IEND" && length === 0 && offset === input.length) return;
  }
  throw new PngError("The PNG file is damaged or incomplete.");
}

export async function compressPng(input: Buffer, mode: CompressionMode, quality = 80) {
  if (!input.length) throw new PngError("Please upload a valid PNG file.");
  if (input.length > MAX_FILE_BYTES) throw new PngError("PNG files must be 10 MB or smaller.", 413);
  if (mode !== "lossless" && mode !== "smaller") throw new PngError("Choose Lossless or Smaller File.");
  if (!Number.isInteger(quality) || quality < 1 || quality > 100) throw new PngError("Quality must be an integer from 1 to 100.");
  validateChunks(input);
  try {
    const image = sharp(input, { limitInputPixels: MAX_PIXELS, failOn: "warning" });
    const metadata = await image.metadata();
    if (metadata.format !== "png") throw new PngError("Please upload a valid PNG file.");
    if ((metadata.pages ?? 1) > 1) throw new PngError("Animated PNG files are not supported. Please upload one static PNG.");
    const width = metadata.width!;
    const height = metadata.height!;
    if (width * height > MAX_PIXELS) throw new PngError("PNG images must contain no more than 25 MP.", 413);
    // Keep high-bit-depth samples intact rather than implicitly downconverting them.
    if (mode === "lossless" && metadata.depth === "ushort") image.toColourspace("rgb16");
    const candidate = await image.png({
      compressionLevel: 9,
      adaptiveFiltering: true,
      palette: mode === "smaller",
      ...(mode === "smaller" ? { quality, effort: 7 } : {}),
    }).toBuffer();
    let output = candidate.length < input.length ? candidate : input;
    if (mode === "lossless" && output !== input) {
      // Protect exact RGBA samples, including RGB values under fully transparent pixels.
      const decode = (buffer: Buffer) => sharp(buffer).toColourspace("rgb16").ensureAlpha().raw({ depth: "ushort" }).toBuffer();
      const before = await decode(input);
      const after = await decode(output);
      if (!before.equals(after)) output = input;
    }
    return { output, originalSize: input.length, outputSize: output.length, width, height, noReduction: output === input };
  } catch (error) {
    if (error instanceof PngError) throw error;
    throw new PngError("The PNG file could not be decoded. Please upload a valid, undamaged PNG.");
  }
}
