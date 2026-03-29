// scripts/booking-import.js
// ---------------------------------------------------------------------------
// Parse booking files (Excel via SheetJS global XLSX, JSON, TXT/NDJSON) and
// POST to apiClient.bookings.importBatch. Surfaces row-level errors from parser + API.
// ---------------------------------------------------------------------------

/**
 * @param {unknown} text
 * @returns {object[]}
 */
function parseJsonBookingFile(text) {
    const trimmed = String(text || "").trim();
    if (!trimmed) {
        throw new Error("JSON file is empty.");
    }
    const data = JSON.parse(trimmed);
    if (Array.isArray(data)) return data;
    if (data && typeof data === "object" && Array.isArray(data.rows)) {
        return data.rows;
    }
    throw new Error('JSON must be an array of rows or { "rows": [...] }.');
}

/**
 * @param {string} text
 * @returns {object[]}
 */
function parseTxtBookingFile(text) {
    const lines = String(text || "")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
    if (!lines.length) throw new Error("Text file has no non-empty lines.");
    const rows = [];
    lines.forEach((line, i) => {
        try {
            const obj = JSON.parse(line);
            if (!obj || typeof obj !== "object") {
                throw new Error("Line is not a JSON object.");
            }
            rows.push(obj);
        } catch (e) {
            throw new Error(`Line ${i + 1}: ${e.message || "invalid JSON"}`);
        }
    });
    return rows;
}

/**
 * @param {ArrayBuffer} arrayBuffer
 * @returns {object[]}
 */
function parseExcelBookingFile(arrayBuffer) {
    if (typeof XLSX === "undefined") {
        throw new Error(
            "Excel parser not loaded. Ensure xlsx.full.min.js is included before booking-import.js.",
        );
    }
    const wb = XLSX.read(arrayBuffer, { type: "array" });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) throw new Error("Workbook has no sheets.");
    const sheet = wb.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    if (!matrix.length) throw new Error("First sheet is empty.");
    const headerRow = matrix[0].map((h) =>
        window.bookingImportFormat.normalizeHeader(h),
    );
    const rows = [];
    for (let r = 1; r < matrix.length; r++) {
        const line = matrix[r];
        const obj = {};
        headerRow.forEach((key, c) => {
            if (!key) return;
            const val = line[c];
            if (val !== undefined && val !== "") obj[key] = val;
        });
        if (Object.keys(obj).length) rows.push(obj);
    }
    return rows;
}

/**
 * Turn raw rows into API payload rows; collects validation errors.
 * @param {object[]} rawRows
 */
function buildImportPayload(rawRows) {
    const fmt = window.bookingImportFormat;
    const rows = [];
    const errors = [];
    rawRows.forEach((raw, i) => {
        const normalized = fmt.normalizeImportRow(raw);
        if (!normalized) {
            errors.push({ row_index: i, error: "Row could not be read." });
            return;
        }
        const v = fmt.validateNormalizedRow(normalized);
        if (!v.ok) {
            errors.push({ row_index: i, error: v.error });
            return;
        }
        rows.push(normalized);
    });
    return { rows, errors };
}

/**
 * @param {File} file
 * @returns {Promise<{ rows: object[], parseErrors: {row_index:number, error:string}[] }>}
 */
async function parseBookingFile(file) {
    const name = (file.name || "").toLowerCase();
    const parseErrors = [];

    if (name.endsWith(".json")) {
        const text = await file.text();
        try {
            const raw = parseJsonBookingFile(text);
            const { rows, errors } = buildImportPayload(raw);
            return { rows, parseErrors: errors };
        } catch (e) {
            throw new Error(e.message || "Invalid JSON.");
        }
    }

    if (name.endsWith(".txt")) {
        const text = await file.text();
        try {
            const raw = parseTxtBookingFile(text);
            const { rows, errors } = buildImportPayload(raw);
            return { rows, parseErrors: errors };
        } catch (e) {
            throw new Error(e.message || "Invalid text file.");
        }
    }

    if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
        const buf = await file.arrayBuffer();
        try {
            const raw = parseExcelBookingFile(buf);
            const { rows, errors } = buildImportPayload(raw);
            return { rows, parseErrors: errors };
        } catch (e) {
            throw new Error(e.message || "Invalid Excel file.");
        }
    }

    throw new Error("Unsupported format. Use .xlsx, .xls, .json, or .txt.");
}

window.bookingImport = {
    parseBookingFile,
    buildImportPayload,
    parseJsonBookingFile,
    parseTxtBookingFile,
    parseExcelBookingFile,
};
