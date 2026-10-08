import "server-only";
import ts from "typescript";
import type { Tool } from "@/db/schema";
import type { Proposal } from "./tool-contract";
export function validateCode(code: string) {
  if (
    typeof code !== "string" ||
    !code.trim() ||
    Buffer.byteLength(code) > 48000
  )
    throw new Error("Generated code must be 1–48 KB.");
  const ast = ts.createSourceFile(
    "tool.cjs",
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const banned = new Set([
    "process",
    "global",
    "globalThis",
    "eval",
    "Function",
    "fetch",
    "WebAssembly",
    "Reflect",
    "Proxy",
    "setTimeout",
    "setInterval",
    "setImmediate",
  ]);
  const dangerous = new Set([
    "constructor",
    "prototype",
    "__proto__",
    "caller",
    "callee",
    "getPrototypeOf",
    "setPrototypeOf",
    "getOwnPropertyDescriptor",
    "getOwnPropertyDescriptors",
    "defineProperty",
    "defineProperties",
    "__defineGetter__",
    "__defineSetter__",
    "__lookupGetter__",
    "__lookupSetter__",
    "prepareStackTrace",
  ]);
  const allowed = new Set([
    "sharp",
    "node:fs/promises",
    "node:path",
    "node:assert/strict",
  ]);
  function visit(node: ts.Node) {
    if (
      ts.isImportDeclaration(node) ||
      ts.isExportDeclaration(node) ||
      node.kind === ts.SyntaxKind.ImportKeyword ||
      ts.isWithStatement(node)
    )
      throw new Error("Imports and dynamic execution are not allowed.");
    if (
      ts.isIdentifier(node) &&
      (banned.has(node.text) || dangerous.has(node.text))
    )
      throw new Error(`Forbidden identifier: ${node.text}`);
    if (ts.isComputedPropertyName(node))
      throw new Error("Computed property names are not allowed.");
    if (
      ts.isElementAccessExpression(node) &&
      !ts.isNumericLiteral(node.argumentExpression)
    )
      throw new Error("Only literal numeric indexed access is allowed.");
    if (ts.isStringLiteral(node) && dangerous.has(node.text))
      throw new Error("Forbidden property.");
    if (ts.isIdentifier(node) && node.text === "require") {
      const parent = node.parent;
      if (
        !ts.isCallExpression(parent) ||
        parent.expression !== node ||
        parent.arguments.length !== 1 ||
        !ts.isStringLiteral(parent.arguments[0]) ||
        !allowed.has(parent.arguments[0].text)
      )
        throw new Error("Only the approved literal require calls are allowed.");
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
}
export function validateUiSchema(
  json: string,
  spec: Proposal,
): Tool["uiSchema"] {
  if (typeof json !== "string" || json.length > 8000)
    throw new Error("Invalid UI schema.");
  const ui = JSON.parse(json) as Tool["uiSchema"];
  if (
    !ui ||
    Object.keys(ui).sort().join() !== "inputs,output,parameters" ||
    !Array.isArray(ui.inputs) ||
    ui.inputs.length !== 1 ||
    ui.inputs[0]?.id !== "image" ||
    ui.inputs[0]?.type !== "image" ||
    ui.inputs[0]?.required !== true ||
    ui.output?.type !== "image" ||
    !Array.isArray(ui.parameters)
  )
    throw new Error("UI must accept one image and return one image.");
  const ids =
    spec.operation === "resize"
      ? ["height", "width"]
      : spec.operation === "rotate"
        ? ["angle"]
        : [];
  if (
    ui.parameters
      .map((p) => p.id)
      .sort()
      .join() !== ids.join()
  )
    throw new Error("UI parameters do not match the confirmed proposal.");
  for (const p of ui.parameters) {
    if (typeof p.label !== "string" || !p.label.trim() || p.label.length > 80)
      throw new Error("Invalid parameter label.");
    if (p.id === "angle") {
      if (
        p.type !== "select" ||
        String(p.default) !== String(spec.angle) ||
        p.options
          ?.map((o) => o.value)
          .sort()
          .join() !== "0,180,270,90" ||
        p.options.some((o) => typeof o.label !== "string")
      )
        throw new Error("Invalid rotation settings.");
    } else if (
      p.type !== "number" ||
      p.min !== 1 ||
      p.max !== 4096 ||
      p.default !== (p.id === "width" ? spec.width : spec.height)
    )
      throw new Error("Invalid resize settings.");
  }
  return ui;
}
