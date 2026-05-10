/**
 * MM-DD-YYYY (zero-padded month/day).
 * Leading YYYY-MM-DD parsed as local calendar date (avoids UTC off-by-one).
 */
export function formatMonthDayYear(input) {
    if (input == null) return "";
    const s = String(input).trim();
    if (!s) return "";
    let d;
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
        const [y, m, day] = s.slice(0, 10).split("-").map(Number);
        d = new Date(y, m - 1, day);
    } else {
        d = new Date(s);
    }
    if (Number.isNaN(d.getTime())) return s;
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const yyyy = d.getFullYear();
    return `${mm}-${dd}-${yyyy}`;
}
