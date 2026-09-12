import { CONSTRAINTS, INDEXES } from "@/lib/neo4j/schema";
import { write } from "@/lib/neo4j/client";

export async function applySchema(): Promise<void> {
  for (const statement of [...CONSTRAINTS, ...INDEXES]) {
    await write(statement);
  }
}
