#!/usr/bin/env bun
import sharp from "sharp";
import { join, dirname } from "path";

const SCRIPT_DIR = decodeURIComponent(dirname(new URL(import.meta.url).pathname));
const SOURCE = join(SCRIPT_DIR, "icon-source.png");
const OUT_DIR = join(SCRIPT_DIR, "..", "public", "icons");

const sizes = [
  { name: "icon-192x192.png", size: 192 },
  { name: "icon-384x384.png", size: 384 },
  { name: "icon-512x512.png", size: 512 },
  { name: "icon-192x192-maskable.png", size: 192 },
  { name: "icon-512x512-maskable.png", size: 512 },
  { name: "apple-touch-icon.png", size: 180 },
];

await Bun.write(join(OUT_DIR, ".gitkeep"), "");

for (const { name, size } of sizes) {
  await sharp(SOURCE).resize(size, size).png().toFile(join(OUT_DIR, name));
  console.log(`Generated ${name} (${size}x${size})`);
}

console.log("\nAll icons generated.");
