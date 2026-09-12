/**
 * MapLibre 6 resolves its web worker with
 *   new URL('./maplibre-gl-worker.mjs', import.meta.url)
 * which bundlers (Turbopack/webpack) do not rewrite, so in a Next.js app the
 * worker 404s. When that happens MapLibre does NOT throw: GeoJSON sources
 * simply never finish parsing, so the map renders nothing, fires no `load`
 * event and reports no error. Very hard to diagnose from the symptom.
 *
 * We copy the worker (and the shared chunk it imports) into public/ and point
 * maplibregl.setWorkerUrl() at the static path instead.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const dist = dirname(require.resolve("maplibre-gl/dist/maplibre-gl.mjs"));
const out = join(process.cwd(), "public", "maplibre");
mkdirSync(out, { recursive: true });

for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(join(dist, file), join(out, file));
  console.log(`  copied ${file} -> public/maplibre/`);
}
