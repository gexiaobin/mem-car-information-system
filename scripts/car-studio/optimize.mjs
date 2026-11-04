import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(path.join(root, ".local/car-studio/package.json"));
const sharp = require("sharp");
const output = path.join(root, "apps/web/public/images/vehicles");
await mkdir(output, { recursive: true });
const input = path.join(root, ".local/car-studio/studio-silver.png");
const { data, info: pixels } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
let x0 = pixels.width, y0 = pixels.height, x1 = 0, y1 = 0;
for (let y = 0; y < pixels.height; y++) for (let x = 0; x < pixels.width; x++) {
  if (data[(y * pixels.width + x) * 4 + 3] < 200) continue;
  x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
}
const left = Math.max(0, x0 - 60), top = Math.max(0, y0 - 20);
const source = await sharp(input).extract({ left, top, width: Math.min(pixels.width, x1 + 61) - left, height: Math.min(pixels.height, y1 + 51) - top }).toBuffer();
for (const [filename, width] of [["studio-silver.webp", 1440], ["studio-silver-small.webp", 720]]) {
  const info = await sharp(source).resize({ width }).webp({ quality: 88, alphaQuality: 100, effort: 6 }).toFile(path.join(output, filename));
  console.log(`${filename}: ${info.width}×${info.height}, ${info.size} bytes`);
}
