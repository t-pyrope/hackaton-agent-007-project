/* eslint-disable @typescript-eslint/no-require-imports -- Node test runner compiles local TypeScript without extra dependencies. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const sharp = require('sharp');
function loadTs(relative) {
  const filename = path.resolve(relative);
  const compiled = new Module(filename);
  compiled.filename = filename;
  compiled.paths = Module._nodeModulePaths(path.dirname(filename));
  const originalRequire = compiled.require.bind(module);
  compiled.require = (id) => id === '@/lib/image-tools/compress-png' ? lib : originalRequire(id);
  compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, filename);
  return compiled.exports;
}
const lib = loadTs('lib/image-tools/compress-png.ts');
const { POST } = loadTs('app/api/image-tools/compress-png/route.ts');
async function fixture(compressionLevel = 0) {
  const pixels = Buffer.alloc(64 * 32 * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = (i / 4) % 256; pixels[i + 1] = 110; pixels[i + 2] = 200;
    pixels[i + 3] = (i / 4) % 3 === 0 ? 0 : 255;
  }
  return sharp(pixels, { raw: { width: 64, height: 32, channels: 4 } }).png({ compressionLevel }).toBuffer();
}
const decode = (buffer) => sharp(buffer).ensureAlpha().raw().toBuffer();
async function post(buffer, mode = 'lossless', quality = '80', extra = false) {
  const form = new FormData();
  form.append('file', new File([buffer], 'fake-name.png', { type: 'image/png' }));
  if (extra) form.append('other', new File([buffer], 'second.png'));
  form.append('mode', mode); form.append('quality', quality);
  return POST(new Request('http://localhost/api/image-tools/compress-png', { method: 'POST', body: form }));
}
test('Lossless preserves exact RGBA pixels, transparency and dimensions', async () => {
  const input = await fixture();
  const result = await lib.compressPng(input, 'lossless');
  assert(result.output.length < input.length);
  assert.deepEqual(await decode(result.output), await decode(input));
  assert.equal(result.width, 64); assert.equal(result.height, 32);
});
test('Smaller File returns palette PNG at both quality extremes with transparency', async () => {
  const input = await fixture();
  for (const quality of [1, 100]) {
    const result = await lib.compressPng(input, 'smaller', quality);
    const metadata = await sharp(result.output).metadata();
    assert.equal(metadata.format, 'png'); assert.equal(metadata.isPalette, true);
    assert.equal(metadata.width, 64); assert.equal(metadata.height, 32); assert.equal(metadata.hasAlpha, true);
    const output = await decode(result.output); const original = await decode(input);
    for (let i = 3; i < output.length; i += 4) assert.equal(output[i], original[i]);
  }
});
test('No size reduction returns exact original bytes in both modes', async () => {
  const input = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  for (const mode of ['lossless', 'smaller']) {
    const result = await lib.compressPng(input, mode);
    assert.equal(result.noReduction, true); assert.deepEqual(result.output, input);
  }
});
test('Rejects non-PNG content despite PNG filename/MIME and damaged PNG', async () => {
  const jpeg = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
  for (const input of [Buffer.from('not an image'), jpeg, (await fixture()).subarray(0, 55)]) {
    const response = await post(input); assert.equal(response.status, 400); assert.match((await response.json()).error, /PNG/);
  }
});
test('Rejects APNG chunks even when default frame is a static PNG', async () => {
  const input = await fixture();
  const chunk = Buffer.alloc(20); chunk.writeUInt32BE(8); chunk.write('acTL', 4); chunk.writeUInt32BE(2, 8);
  const apng = Buffer.concat([input.subarray(0, 33), chunk, input.subarray(33)]);
  await assert.rejects(lib.compressPng(apng, 'lossless'), /Animated PNG/);
});
test('Rejects >10 MB, >25 MP, multiple files and invalid mode/quality', async () => {
  await assert.rejects(lib.compressPng(Buffer.alloc(lib.MAX_FILE_BYTES + 1), 'lossless'), /10 MB/);
  const input = await fixture(); const big = Buffer.from(input); big.writeUInt32BE(5001, 16); big.writeUInt32BE(5000, 20);
  await assert.rejects(lib.compressPng(big, 'lossless'), /25 MP/);
  assert.equal((await post(input, 'lossless', '80', true)).status, 400);
  assert.equal((await post(input, 'wrong')).status, 400);
  for (const quality of ['0', '101', '1.5', 'invalid']) assert.equal((await post(input, 'smaller', quality)).status, 400);
});
test('POST returns binary PNG and size/no-reduction headers, never caches', async () => {
  for (const mode of ['lossless', 'smaller']) {
    const input = await fixture(); const response = await post(input, mode);
    assert.equal(response.status, 200); assert.equal(response.headers.get('Content-Type'), 'image/png');
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const output = Buffer.from(await response.arrayBuffer());
    assert.equal(Number(response.headers.get('X-Output-Size')), output.length);
    assert.equal(Number(response.headers.get('X-Original-Size')), input.length);
    assert.equal((await sharp(output).metadata()).format, 'png');
  }
});
