import { Platform } from "react-native";
import { executeSql, isPostgresPoolerAvailable } from "../native/postgresPooler";

/**
 * True only in a dev/production build that includes PostgresPooler (Android).
 * Expo Go never has custom native modules — always false there → PostgREST path.
 */
export function usePoolerBackend() {
  return (
    isPostgresPoolerAvailable() &&
    Platform.OS === "android" &&
    String(process.env.EXPO_PUBLIC_USE_SUPABASE_POOLER || "")
      .toLowerCase()
      .trim() === "true" &&
    Boolean(
      String(process.env.EXPO_PUBLIC_DB_HOST || "").trim() &&
        String(process.env.EXPO_PUBLIC_DB_USER || "").trim(),
    )
  );
}

export function buildJdbcUrlFromEnv() {
  const host = String(process.env.EXPO_PUBLIC_DB_HOST || "").trim();
  const port = String(process.env.EXPO_PUBLIC_DB_PORT || "5432").trim();
  const name = String(process.env.EXPO_PUBLIC_DB_NAME || "postgres").trim();
  if (!host) return "";
  return `jdbc:postgresql://${host}:${port}/${name}?sslmode=require`;
}

function assertPoolerEnv() {
  const url = buildJdbcUrlFromEnv();
  const user = String(process.env.EXPO_PUBLIC_DB_USER || "").trim();
  const pass = process.env.EXPO_PUBLIC_DB_PASSWORD;
  if (!url || !user) {
    throw new Error(
      "Pooler mode: set EXPO_PUBLIC_USE_SUPABASE_POOLER=true and EXPO_PUBLIC_DB_HOST, EXPO_PUBLIC_DB_USER, EXPO_PUBLIC_DB_PASSWORD (and optional DB_NAME, DB_PORT) like Django DATABASES.",
    );
  }
  return { url, user, pass: pass != null ? String(pass) : "" };
}

const DEFAULT_MAX_ROWS = 100000;

/**
 * @param {string} sql
 * @param {number} [maxRows]
 * @returns {Promise<{ kind: 'rows', rows: object[], rowCount: number, truncated: boolean } | { kind: 'update', updateCount: number }>}
 */
export async function poolerRun(sql, maxRows = DEFAULT_MAX_ROWS) {
  const { url, user, pass } = assertPoolerEnv();
  return executeSql(url, user, pass, sql, maxRows);
}
