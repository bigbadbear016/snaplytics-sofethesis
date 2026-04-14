import { NativeModules, Platform } from "react-native";

const { PostgresPooler } = NativeModules;

export function isPostgresPoolerAvailable() {
  return Platform.OS === "android" && PostgresPooler != null;
}

/**
 * @param {string} jdbcUrl
 * @param {string} user
 * @param {string} password
 * @param {string} sql
 * @param {number} [maxRows]
 * @returns {Promise<{ kind: 'rows', rows: object[], columns?: string[], rowCount: number, truncated: boolean } | { kind: 'update', updateCount: number }>}
 */
export function executeSql(jdbcUrl, user, password, sql, maxRows = 100000) {
  if (!PostgresPooler?.executeSql) {
    return Promise.reject(
      new Error("PostgresPooler.executeSql missing (Android native module)."),
    );
  }
  return PostgresPooler.executeSql(
    jdbcUrl,
    user,
    password,
    sql || "",
    Number(maxRows) || 100000,
  );
}

/** Legacy POC entry (small row cap). */
export function runPoolerQuery(jdbcUrl, user, password, sql) {
  if (!PostgresPooler) {
    return Promise.reject(
      new Error("PostgresPooler native module missing (Android only)."),
    );
  }
  if (PostgresPooler.executeSql) {
    return PostgresPooler.executeSql(
      jdbcUrl,
      user,
      password,
      sql || "",
      200,
    );
  }
  return PostgresPooler.runQuery(jdbcUrl, user, password, sql || "");
}
