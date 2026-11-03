import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Config } from "./config.js";
export const tables = [
  "users",
  "models",
  "projects",
  "rules",
  "vehicles",
  "stores",
  "offers",
  "offer_versions",
  "slots",
  "appointments",
  "changes",
  "faults",
  "messages",
  "imports",
  "registration_imports",
  "records",
  "observations",
  "logs",
  "files",
] as const;
export type Table = (typeof tables)[number];
export interface Sql {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<T[]>;
}
export interface Database extends Sql {
  transaction<T>(work: (sql: Sql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  migrate(): Promise<void>;
}
export async function connectDatabase(config: Config): Promise<Database> {
  if (config.driver === "pglite") {
    if (config.pglitePath !== ":memory:")
      await mkdir(dirname(config.pglitePath), { recursive: true });
    const db = new PGlite(
      config.pglitePath === ":memory:" ? undefined : config.pglitePath,
    );
    await db.waitReady;
    let pending: Promise<unknown> = Promise.resolve();
    const run = <T>(job: () => Promise<T>): Promise<T> => {
      const next = pending.then(job, job);
      pending = next.catch(() => {});
      return next;
    };
    const direct: Sql = {
      query: async <T>(sql: string, params: unknown[] = []) =>
        (await db.query<T>(sql, params)).rows,
    };
    return {
      query: <T>(sql: string, params: unknown[] = []) =>
        run(() => direct.query<T>(sql, params)),
      transaction: <T>(work: (sql: Sql) => Promise<T>) =>
        run(async () => {
          await direct.query("BEGIN");
          try {
            const value = await work(direct);
            await direct.query("COMMIT");
            return value;
          } catch (error) {
            await direct.query("ROLLBACK");
            throw error;
          }
        }),
      close: async () => {
        await pending;
        await db.close();
      },
      migrate: async () => {
        for (const sql of migrationStatements) await direct.query(sql);
      },
    };
  }
  const { schema, ...pgConfig } = config.pg;
  const pool = new pg.Pool({
    ...pgConfig,
    max: 10,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    options: `-c timezone=Asia/Shanghai -c client_encoding=UTF8 -c search_path=${schema || "public"}`,
  });
  const direct: Sql = {
    query: async <T>(sql: string, params: unknown[] = []) =>
      (await pool.query(sql, params)).rows as T[],
  };
  return {
    query: direct.query,
    transaction: async <T>(work: (sql: Sql) => Promise<T>) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const value = await work({
          query: async <R>(sql: string, params: unknown[] = []) =>
            (await client.query(sql, params)).rows as R[],
        });
        await client.query("COMMIT");
        return value;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    close: async () => {
      await pool.end();
    },
    migrate: async () => {
      for (const sql of migrationStatements) await direct.query(sql);
    },
  };
}
const migrationStatements = [
  ...tables.map(
    (name) =>
      `CREATE TABLE IF NOT EXISTS av_${name} (id text PRIMARY KEY, data jsonb NOT NULL CHECK(jsonb_typeof(data) = 'object')${name === "slots" ? `, CONSTRAINT av_slots_capacity_check CHECK ((data->>'reserved')::integer >= 0 AND (data->>'capacity')::integer >= (data->>'reserved')::integer)` : ""})`,
  ),
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='av_slots_capacity_check' AND conrelid='av_slots'::regclass) THEN ALTER TABLE av_slots ADD CONSTRAINT av_slots_capacity_check CHECK ((data->>'reserved')::integer >= 0 AND (data->>'capacity')::integer >= (data->>'reserved')::integer); END IF; END $$`,
  `CREATE TABLE IF NOT EXISTS av_sessions (hash text PRIMARY KEY, user_id text NOT NULL REFERENCES av_users(id), expires_at timestamptz NOT NULL)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS av_users_email ON av_users(lower(data->>'email'))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS av_booking_request ON av_appointments((data->>'ownerId'), (data->>'requestId'))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS av_record_project ON av_records((data->>'appointmentId'), (data->>'projectId'))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS av_observation_import ON av_observations((data->>'importId'))`,
  `CREATE INDEX IF NOT EXISTS av_vehicle_owner ON av_vehicles((data->>'ownerId'))`,
  `CREATE INDEX IF NOT EXISTS av_booking_vehicle ON av_appointments((data->>'vehicleId'), (data->>'status'))`,
  `CREATE INDEX IF NOT EXISTS av_booking_store ON av_appointments((data->>'storeId'), (data->>'status'))`,
  `CREATE INDEX IF NOT EXISTS av_message_user ON av_messages((data->>'userId'))`,
  `CREATE INDEX IF NOT EXISTS av_session_expiration ON av_sessions(expires_at)`,
  `CREATE INDEX IF NOT EXISTS av_import_status ON av_imports((data->>'status'))`,
  `CREATE INDEX IF NOT EXISTS av_registration_owner ON av_registration_imports((data->>'ownerId'))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS av_import_image ON av_imports((data->>'ownerId'), (data->>'vehicleId'), (data->>'imageHash')) WHERE data->>'imageHash' IS NOT NULL`,
];
function tableName(table: Table): string {
  if (!tables.includes(table)) throw new Error("Unknown entity");
  return `av_${table}`;
}
export async function list<T>(sql: Sql, table: Table): Promise<T[]> {
  return (
    await sql.query<{ data: T }>(
      `SELECT data FROM ${tableName(table)} ORDER BY id`,
    )
  ).map((row) => row.data);
}
export async function get<T>(
  sql: Sql,
  table: Table,
  id: string,
  lock = false,
): Promise<T | undefined> {
  return (
    await sql.query<{ data: T }>(
      `SELECT data FROM ${tableName(table)} WHERE id=$1${lock ? " FOR UPDATE" : ""}`,
      [id],
    )
  )[0]?.data;
}
export async function put<T extends { id: string }>(
  sql: Sql,
  table: Table,
  value: T,
): Promise<T> {
  await sql.query(
    `INSERT INTO ${tableName(table)} (id,data) VALUES ($1,$2::jsonb) ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data`,
    [value.id, JSON.stringify(value)],
  );
  return value;
}
export async function remove(sql: Sql, table: Table, id: string) {
  await sql.query(`DELETE FROM ${tableName(table)} WHERE id=$1`, [id]);
}
