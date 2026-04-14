/** SQL builders for Supabase/Django table names (Postgres pooler / JDBC).
 *  PostgREST accepts short FK names (e.g. `customer`); real columns are `customer_id`.
 */

const ALLOWED_TABLES = new Set([
  "backend_category",
  "backend_package",
  "backend_addon",
  "backend_customer",
  "backend_booking",
  "backend_bookingaddon",
  "backend_coupon",
  "backend_couponsent",
  "backend_couponusage",
]);

/** PostgREST-style alias → actual PostgreSQL column (Django ForeignKey *_id). */
const POOLER_FK_COLUMN = {
  backend_booking: {
    customer: "customer_id",
    package: "package_id",
    coupon: "coupon_id",
  },
  backend_bookingaddon: {
    booking: "booking_id",
    addon: "addon_id",
  },
  backend_couponsent: {
    coupon: "coupon_id",
    customer: "customer_id",
  },
  backend_couponusage: {
    coupon: "coupon_id",
    customer: "customer_id",
    booking: "booking_id",
  },
};

function qId(name) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(String(name || ""))) {
    throw new Error(`Invalid SQL identifier: ${name}`);
  }
  return `"${String(name).replace(/"/g, '""')}"`;
}

function assertTable(table) {
  if (!ALLOWED_TABLES.has(table)) {
    throw new Error(`Unknown table: ${table}`);
  }
}

export function resolveColumnForTable(table, key) {
  const k = String(key || "").trim();
  const map = POOLER_FK_COLUMN[table];
  if (map && map[k]) return map[k];
  return k;
}

/** JDBC rows use `customer_id`; JS expects `customer` like PostgREST embeds. */
export function hydratePoolerRow(table, row) {
  if (!row || typeof row !== "object") return row;
  const out = { ...row };
  const map = POOLER_FK_COLUMN[table];
  if (map) {
    for (const [short, long] of Object.entries(map)) {
      if (out[long] !== undefined && out[long] !== null && out[short] === undefined) {
        out[short] = out[long];
      }
    }
  }
  return out;
}

export function pgLiteral(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (value instanceof Date) return `'${value.toISOString()}'::timestamptz`;
  const s = String(value);
  return `'${s.replace(/'/g, "''")}'`;
}

function pgTypedLiteral(raw) {
  const v = String(raw);
  if (/^-?\d+$/.test(v)) return v;
  if (/^-?\d+\.\d+$/.test(v)) return v;
  return pgLiteral(decodeURIComponent(v));
}

function parseOrder(table, orderBy) {
  if (!orderBy) return "";
  const idx = orderBy.lastIndexOf(".");
  if (idx <= 0) return "";
  const colRaw = orderBy.slice(0, idx);
  const dir = orderBy.slice(idx + 1).toUpperCase();
  const d = dir === "DESC" ? "DESC" : "ASC";
  const col = resolveColumnForTable(table, colRaw);
  return ` ORDER BY ${qId(col)} ${d}`;
}

function buildWhere(table, filters) {
  if (!filters || !filters.length) return "";
  const parts = [];
  for (const [key, val] of filters) {
    const col = qId(resolveColumnForTable(table, key));
    if (val === "is.null") {
      parts.push(`${col} IS NULL`);
      continue;
    }
    const s = String(val);
    if (s.startsWith("eq.")) {
      parts.push(`${col} = ${pgTypedLiteral(s.slice(3))}`);
    } else if (s.startsWith("ilike.")) {
      parts.push(`${col} ILIKE ${pgLiteral(decodeURIComponent(s.slice(6)))}`);
    } else if (s.startsWith("in.(") && s.endsWith(")")) {
      const inner = s.slice(4, -1);
      const items = inner
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
      const list = items.map((x) => pgTypedLiteral(x)).join(", ");
      parts.push(`${col} IN (${list})`);
    } else {
      throw new Error(`Unsupported filter: ${key}=${val}`);
    }
  }
  return ` WHERE ${parts.join(" AND ")}`;
}

function selectList(table, select) {
  if (!select || select === "*") return "*";
  return select
    .split(",")
    .map((c) => qId(resolveColumnForTable(table, c.trim())))
    .join(", ");
}

export function buildSelectSql(table, { select = "*", filters = [], orderBy = null } = {}) {
  assertTable(table);
  const where = buildWhere(table, filters);
  const order = parseOrder(table, orderBy);
  return `SELECT ${selectList(table, select)} FROM ${qId(table)}${where}${order}`;
}

export function buildInsertSql(table, payload) {
  assertTable(table);
  if (!payload || typeof payload !== "object") {
    throw new Error("insert payload required");
  }
  const keys = Object.keys(payload).filter(
    (k) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k) && payload[k] !== undefined,
  );
  if (!keys.length) throw new Error("insert: no columns");
  const cols = keys.map((k) => qId(resolveColumnForTable(table, k))).join(", ");
  const vals = keys.map((k) => pgLiteral(payload[k])).join(", ");
  return `INSERT INTO ${qId(table)} (${cols}) VALUES (${vals}) RETURNING *`;
}

function pgIdCompareValue(idValue) {
  const s = decodeURIComponent(String(idValue));
  if (/^-?\d+$/.test(s)) return s;
  return pgLiteral(s);
}

export function buildUpdateSql(table, idField, idValue, payload) {
  assertTable(table);
  if (!payload || typeof payload !== "object") {
    throw new Error("update payload required");
  }
  const idCol = resolveColumnForTable(table, idField);
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(String(idCol))) {
    throw new Error("invalid id field");
  }
  const sets = Object.keys(payload)
    .filter((k) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k) && payload[k] !== undefined)
    .map((k) => `${qId(resolveColumnForTable(table, k))} = ${pgLiteral(payload[k])}`)
    .join(", ");
  if (!sets) throw new Error("update: no columns");
  return `UPDATE ${qId(table)} SET ${sets} WHERE ${qId(idCol)} = ${pgIdCompareValue(
    idValue,
  )} RETURNING *`;
}
