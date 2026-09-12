import { config } from "dotenv";
import { resolve } from "node:path";

// Load .env.local first (Next.js convention), then .env as a fallback.
config({ path: resolve(process.cwd(), ".env.local"), quiet: true });
config({ path: resolve(process.cwd(), ".env"), quiet: true });
