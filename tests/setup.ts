import { config } from "dotenv";
import { resolve } from "node:path";

/**
 * Load Neo4j Aura credentials before any test imports `@/lib/neo4j/client`.
 * Mirrors scripts/env.ts: `.env.local` first (Next.js convention), `.env` as a
 * fallback, so the tests and the app read exactly the same configuration.
 */
config({ path: resolve(process.cwd(), ".env.local"), quiet: true });
config({ path: resolve(process.cwd(), ".env"), quiet: true });
