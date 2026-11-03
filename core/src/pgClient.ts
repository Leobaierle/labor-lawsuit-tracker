import pg from "pg";

const { Pool } = pg;

export type ProcessosPool = pg.Pool;
export type Executor = Pick<pg.ClientBase, "query">;

let cachedPool: ProcessosPool | null = null;

/**
 * Pool do schema `dp_processos_trabalhistas` no Supabase. Em produção:
 * postgresql://dp_processos_app.<tenant>:<senha>@db.example.internal:6543/postgres (Supavisor em modo transação).
 */
export const getProcessosPool = (): ProcessosPool => {
  if (cachedPool) return cachedPool;
  const connectionString = process.env.DP_PROCESSOS_DATABASE_URL;
  if (!connectionString) {
    throw new Error("DP_PROCESSOS_DATABASE_URL is not set; cannot connect to the dp_processos_trabalhistas schema");
  }
  cachedPool = new Pool({ connectionString, max: Number(process.env.DP_PROCESSOS_PG_POOL_MAX ?? 3), idleTimeoutMillis: 30_000 });
  cachedPool.on("error", (error) => console.error("[dp-processos-trabalhistas] postgres pool error:", error));
  return cachedPool;
};

export const closeProcessosPool = async (): Promise<void> => {
  if (!cachedPool) return;
  await cachedPool.end();
  cachedPool = null;
};

/** Transação com o autor gravado para o trigger de histórico (set_config local à transação). */
export const withTransaction = async <T>(
  pool: ProcessosPool,
  autor: string,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL search_path = dp_processos_trabalhistas");
    await client.query("SELECT set_config('dp_processos.autor', $1, true)", [autor]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};
