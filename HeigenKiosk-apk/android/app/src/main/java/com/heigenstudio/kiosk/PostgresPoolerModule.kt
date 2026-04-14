package com.heigenstudio.kiosk

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.sql.DriverManager
import java.sql.Statement
import java.util.Properties
import java.util.concurrent.Executors

/**
 * JDBC to Postgres (Supabase pooler). Same wire protocol as Django/psycopg2; credentials must stay off-device in production.
 */
class PostgresPoolerModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private val executor = Executors.newSingleThreadExecutor()

    override fun getName(): String = "PostgresPooler"

    @ReactMethod
    fun executeSql(
        jdbcUrl: String,
        user: String,
        password: String,
        sql: String,
        maxRows: Double,
        promise: Promise,
    ) {
        val url = jdbcUrl.trim()
        val q = sql.trim().ifEmpty {
            promise.reject("E_PG_SQL", "sql is empty", null)
            return
        }
        if (url.isEmpty()) {
            promise.reject("E_PG_CONFIG", "jdbcUrl is empty", null)
            return
        }
        val cap = when {
            maxRows.isNaN() || maxRows <= 0 -> 100000
            else -> maxRows.toInt().coerceIn(1, 200000)
        }
        executor.execute {
            try {
                Class.forName("org.postgresql.Driver")
                val props = Properties()
                props["user"] = user
                props["password"] = password
                DriverManager.getConnection(url, props).use { conn ->
                    conn.createStatement().use { stmt ->
                        stmt.maxRows = cap
                        val hasRs = stmt.execute(q)
                        if (hasRs) {
                            stmt.resultSet.use { rs ->
                                val meta = rs.metaData
                                val colCount = meta.columnCount
                                val columns = Arguments.createArray()
                                for (i in 1..colCount) {
                                    columns.pushString(meta.getColumnLabel(i))
                                }
                                val rows = Arguments.createArray()
                                var rowCap = 0
                                var truncated = false
                                while (rowCap < cap && rs.next()) {
                                    val row = Arguments.createMap()
                                    for (i in 1..colCount) {
                                        val label = meta.getColumnLabel(i)
                                        val obj = rs.getObject(i)
                                        when (obj) {
                                            null -> row.putNull(label)
                                            is Number -> row.putDouble(label, obj.toDouble())
                                            is Boolean -> row.putBoolean(label, obj)
                                            else -> row.putString(label, obj.toString())
                                        }
                                    }
                                    rows.pushMap(row)
                                    rowCap++
                                }
                                if (rs.next()) {
                                    truncated = true
                                }
                                val out = Arguments.createMap()
                                out.putString("kind", "rows")
                                out.putArray("columns", columns)
                                out.putArray("rows", rows)
                                out.putInt("rowCount", rowCap)
                                out.putBoolean("truncated", truncated)
                                promise.resolve(out)
                            }
                        } else {
                            val uc = stmt.updateCount
                            val out = Arguments.createMap()
                            out.putString("kind", "update")
                            out.putInt("updateCount", uc)
                            promise.resolve(out)
                        }
                    }
                }
            } catch (e: Throwable) {
                promise.reject("PG_ERROR", e.message ?: e.javaClass.simpleName, e)
            }
        }
    }

    /** @deprecated use executeSql */
    @ReactMethod
    fun runQuery(jdbcUrl: String, user: String, password: String, sql: String, promise: Promise) {
        executeSql(jdbcUrl, user, password, sql, 200.0, promise)
    }
}
