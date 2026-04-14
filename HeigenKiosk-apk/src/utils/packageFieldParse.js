/**
 * Package list fields (inclusions, freebies) may arrive as JSON arrays, JSON strings,
 * or plain strings depending on PostgREST vs JDBC. Normalize to string[] for UI.
 */
export function parseStringArrayField(value) {
  if (value == null || value === "") return null;
  if (Array.isArray(value)) {
    return value
      .map((x) => (x == null ? "" : String(x).trim()))
      .filter(Boolean);
  }
  if (typeof value === "string") {
    const t = value.trim();
    if (t === "" || t === "[]") return [];
    if (t.startsWith("[") || t.startsWith("{")) {
      try {
        const p = JSON.parse(t);
        if (Array.isArray(p)) {
          return p.map((x) => String(x).trim()).filter(Boolean);
        }
        if (p && typeof p === "object") {
          return Object.values(p)
            .map((x) => String(x).trim())
            .filter(Boolean);
        }
      } catch (_) {
        return [t];
      }
    }
    return [t];
  }
  if (typeof value === "object") {
    return Object.values(value)
      .map((x) => String(x).trim())
      .filter(Boolean);
  }
  return [String(value)];
}

/**
 * Integer portrait count; JDBC/JSON may return string "[]" or odd values.
 * @returns {number|null} null = omit line; 0+ = show label
 */
export function normalizeIncludedPortraitsField(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw < 0 ? null : raw;
  }
  const s = String(raw).trim();
  if (s === "[]" || s === "") return 0;
  if (s.startsWith("[")) {
    try {
      const j = JSON.parse(s);
      if (Array.isArray(j) && j.length === 0) return 0;
    } catch (_) {
      return null;
    }
    return null;
  }
  const n = parseInt(s, 10);
  if (Number.isFinite(n) && n >= 0) return n;
  return null;
}

/** Label for package card / summary (no raw "[]"). Accepts raw DB/JDBC values. */
export function formatPortraitIncludedLine(raw) {
  const n = normalizeIncludedPortraitsField(raw);
  if (n == null) return null;
  if (n === 0) return "portrait(s) included";
  return `${n} portrait(s) included`;
}
