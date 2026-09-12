import neo4j, { Driver, Session, RecordShape } from "neo4j-driver";

/**
 * Neo4j Aura connection.
 *
 * Lifeline has NO offline fallback by design: every safety-relevant answer in
 * this product is a graph traversal. If the graph is unreachable the product
 * must say so loudly rather than invent a route, so `getDriver()` throws and
 * the API surfaces a hard failure to the UI.
 */

const globalForNeo4j = globalThis as unknown as { __lifelineDriver?: Driver };

export class GraphUnavailableError extends Error {
  readonly code = "GRAPH_UNAVAILABLE";
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "GraphUnavailableError";
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new GraphUnavailableError(
      `Missing ${name}. Lifeline cannot reason about safe routes without Neo4j. ` +
        `Copy .env.example to .env.local and fill in your Neo4j Aura credentials.`,
    );
  }
  return value;
}

export function getDriver(): Driver {
  if (globalForNeo4j.__lifelineDriver) return globalForNeo4j.__lifelineDriver;

  const uri = requireEnv("NEO4J_URI");
  const username = requireEnv("NEO4J_USERNAME");
  const password = requireEnv("NEO4J_PASSWORD");

  const driver = neo4j.driver(uri, neo4j.auth.basic(username, password), {
    maxConnectionPoolSize: 20,
    connectionAcquisitionTimeout: 15_000,
    // Numbers stay in JS-safe range for this dataset; returning plain numbers
    // keeps the API payloads JSON-serialisable without a conversion pass.
    disableLosslessIntegers: true,
  });

  globalForNeo4j.__lifelineDriver = driver;
  return driver;
}

export function getDatabase(): string {
  return process.env.NEO4J_DATABASE || "neo4j";
}

export async function verifyGraph(): Promise<{ ok: true; version: string } | { ok: false; error: string }> {
  try {
    const driver = getDriver();
    await driver.verifyConnectivity({ database: getDatabase() });
    const rows = await read<{ version: string }>(
      "CALL dbms.components() YIELD name, versions RETURN name + ' ' + versions[0] AS version",
    );
    return { ok: true, version: rows[0]?.version ?? "Neo4j" };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function withSession<T>(mode: "READ" | "WRITE", fn: (session: Session) => Promise<T>): Promise<T> {
  let driver: Driver;
  try {
    driver = getDriver();
  } catch (error) {
    if (error instanceof GraphUnavailableError) throw error;
    throw new GraphUnavailableError("Could not create the Neo4j driver.", error);
  }

  const session = driver.session({
    database: getDatabase(),
    defaultAccessMode: mode === "READ" ? neo4j.session.READ : neo4j.session.WRITE,
  });
  try {
    return await fn(session);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/ServiceUnavailable|SessionExpired|Could not perform discovery|ECONNREFUSED|routing/i.test(message)) {
      throw new GraphUnavailableError(`Neo4j is unreachable: ${message}`, error);
    }
    throw error;
  } finally {
    await session.close();
  }
}

/** Run a read query and return plain JS objects. */
export async function read<T extends RecordShape = RecordShape>(
  cypher: string,
  params: Record<string, unknown> = {},
): Promise<T[]> {
  return withSession("READ", async (session) => {
    const result = await session.run(cypher, params);
    return result.records.map((record) => record.toObject() as T);
  });
}

/** Run a read query and also report how long Neo4j took (for the judge panel). */
export async function readTimed<T extends RecordShape = RecordShape>(
  cypher: string,
  params: Record<string, unknown> = {},
): Promise<{ rows: T[]; ms: number }> {
  const started = Date.now();
  const rows = await read<T>(cypher, params);
  return { rows, ms: Date.now() - started };
}

/** Run a write query. */
export async function write<T extends RecordShape = RecordShape>(
  cypher: string,
  params: Record<string, unknown> = {},
): Promise<T[]> {
  return withSession("WRITE", async (session) => {
    const result = await session.run(cypher, params);
    return result.records.map((record) => record.toObject() as T);
  });
}

/** Run several write statements inside one transaction. */
export async function writeTx(statements: { cypher: string; params?: Record<string, unknown> }[]): Promise<void> {
  await withSession("WRITE", async (session) => {
    await session.executeWrite(async (tx) => {
      for (const statement of statements) {
        await tx.run(statement.cypher, statement.params ?? {});
      }
    });
  });
}

export async function closeDriver(): Promise<void> {
  if (globalForNeo4j.__lifelineDriver) {
    await globalForNeo4j.__lifelineDriver.close();
    globalForNeo4j.__lifelineDriver = undefined;
  }
}
