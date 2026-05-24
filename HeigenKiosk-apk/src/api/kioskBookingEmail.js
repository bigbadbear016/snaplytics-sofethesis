/** Booking confirmation email (matches Snaplytics backend/booking_email.py layout). */

const E_PAGE_BG = "linear-gradient(165deg,#b4ccd4 0%,#9bb5bc 48%,#89a8b4 100%)";
const E_HEADER_GRADIENT =
    "linear-gradient(145deg,#1a6578 0%,#165166 45%,#0f3d4d 100%)";
const E_TEAL = "#165166";
const E_TEAL_DK = "#134152";
const E_SLATE = "#5f6e79";
const E_SLATE_DK = "#4f6e79";
const E_TEXT_BODY = "#616161";
const E_TEXT_STRONG = "#37352F";
const E_BORDER = "#E0E0E0";
const E_CARD_WARM = "#fffefb";
const E_SURFACE = "#ffffff";
const E_SHADOW_CARD = "0 8px 32px rgba(22,81,102,0.14)";
const E_FONT = '"Segoe UI","Inter",Roboto,Helvetica,Arial,sans-serif';

const DEFAULT_LOGO_URL =
    "https://api.builder.io/api/v1/image/assets/TEMP/0fdade257f0aa6c53979aa05f0c346a41b70e926?width=475";

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function formatMoneyPeso(amount) {
    if (amount == null || amount === "") return "—";
    const x = Number(amount);
    if (!Number.isFinite(x)) return "—";
    return `₱${x.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatSessionDate(preferredDate, createdAtIso) {
    const raw = preferredDate || createdAtIso;
    if (!raw) return "—";
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return "—";
    return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

function headerLogoHtml() {
    const url =
        String(process.env.EXPO_PUBLIC_EMAIL_LOGO_URL || "").trim() ||
        DEFAULT_LOGO_URL;
    const src = escapeHtml(url);
    return (
        `<img src="${src}" alt="Heigen Studio" width="200" ` +
        `style="display:block;margin:0 auto;border:0;width:200px;max-width:100%;height:auto;" />`
    );
}

/**
 * @param {{
 *   bookingId: number,
 *   customerName: string,
 *   packageName: string,
 *   sessionStatus: string,
 *   preferredDate?: string|null,
 *   createdAt?: string,
 *   addons?: { name: string, quantity: number, total: number }[],
 *   totalPrice: number,
 *   discountNote?: string|null,
 *   couponDiscountAmount?: number|null,
 * }} params
 */
export function buildKioskConfirmationEmail(params) {
    const name = (params.customerName || "").trim() || "Customer";
    const pkgLabel = (params.packageName || "").trim() || "—";
    const dateLine = formatSessionDate(params.preferredDate, params.createdAt);
    const statusLine = (params.sessionStatus || "").trim() || "—";
    const totalStr = formatMoneyPeso(params.totalPrice);

    const addons = params.addons || [];
    const addonPlain = addons.length
        ? addons
              .map(
                  (a) =>
                      `  • ${a.name} × ${a.quantity} — ${formatMoneyPeso(a.total)}`,
              )
              .join("\n")
        : "  (none)";

    let addonRowsHtml = "";
    for (const a of addons) {
        addonRowsHtml +=
            "<tr>" +
            `<td style="padding:8px 0;border-bottom:1px solid ${E_BORDER};font-size:14px;color:${E_SLATE_DK};">` +
            `${escapeHtml(a.name)} <span style="color:${E_SLATE};">× ${a.quantity}</span></td>` +
            `<td style="padding:8px 0;border-bottom:1px solid ${E_BORDER};text-align:right;font-size:14px;color:${E_TEXT_STRONG};">` +
            `${escapeHtml(formatMoneyPeso(a.total))}</td></tr>`;
    }
    const addonsHtml = addonRowsHtml
        ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0">${addonRowsHtml}</table>`
        : `<p style="margin:0;font-size:14px;color:${E_SLATE};">(none)</p>`;

    let discountPlain = "";
    let discountHtml = "";
    if (params.discountNote) {
        discountPlain = `\nDiscount / coupon note: ${params.discountNote}`;
        discountHtml =
            `<p style="margin:16px 0 0;font-size:14px;color:${E_SLATE_DK};">` +
            `<strong>Discount / coupon</strong><br>${escapeHtml(params.discountNote)}</p>`;
    } else if (params.couponDiscountAmount) {
        const d = formatMoneyPeso(params.couponDiscountAmount);
        discountPlain = `\nCoupon discount: ${d}`;
        discountHtml =
            `<p style="margin:16px 0 0;font-size:14px;color:${E_SLATE_DK};">` +
            `<strong>Coupon discount</strong> · ${escapeHtml(d)}</p>`;
    }

    const subject = `Heigen Studio — booking confirmed (#${params.bookingId})`;
    const plain =
        `Hi ${name},\n\n` +
        `Booking reference: #${params.bookingId}\n` +
        `Package: ${pkgLabel}\n` +
        `Preferred session date: ${dateLine}\n` +
        `Status: ${statusLine}\n\n` +
        `Add-ons:\n${addonPlain}\n` +
        `${discountPlain}\n\n` +
        `Total due: ${totalStr}\n\n` +
        `If anything looks wrong, reply to this email or contact the studio.\n\n` +
        `— Heigen Studio\n`;

    const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:${E_PAGE_BG};font-family:${E_FONT};">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${E_PAGE_BG};padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" style="max-width:560px;background:${E_SURFACE};border-radius:12px;overflow:hidden;box-shadow:${E_SHADOW_CARD};">
<tr><td style="background:${E_HEADER_GRADIENT};padding:28px 20px;text-align:center;">
${headerLogoHtml()}
<h1 style="margin:20px 0 0;font-size:22px;font-weight:600;color:#fff;">Booking confirmed</h1>
</td></tr>
<tr><td style="padding:28px 24px;background:linear-gradient(180deg,${E_CARD_WARM} 0%,${E_SURFACE} 28%);">
<p style="margin:0 0 24px;font-size:15px;color:${E_TEXT_BODY};">Hi ${escapeHtml(name)},</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0">
<tr><td style="padding:10px 0;font-size:13px;color:${E_SLATE};width:42%;">Booking reference</td>
<td style="padding:10px 0;font-size:14px;color:${E_TEAL};font-weight:600;">#${params.bookingId}</td></tr>
<tr><td style="padding:10px 0;font-size:13px;color:${E_SLATE};">Package</td>
<td style="padding:10px 0;font-size:14px;color:${E_TEXT_STRONG};">${escapeHtml(pkgLabel)}</td></tr>
<tr><td style="padding:10px 0;font-size:13px;color:${E_SLATE};">Preferred session date</td>
<td style="padding:10px 0;font-size:14px;color:${E_TEXT_STRONG};">${escapeHtml(dateLine)}</td></tr>
<tr><td style="padding:10px 0;font-size:13px;color:${E_SLATE};">Status</td>
<td style="padding:10px 0;font-size:14px;color:${E_TEXT_STRONG};">${escapeHtml(statusLine)}</td></tr>
</table>
<h2 style="margin:24px 0 12px;font-size:13px;font-weight:600;color:${E_TEAL};text-transform:uppercase;">Add-ons</h2>
${addonsHtml}
${discountHtml}
<table role="presentation" width="100%" style="margin-top:24px;border-top:2px solid ${E_BORDER};">
<tr><td style="padding:16px 0;font-size:15px;color:${E_SLATE_DK};">Total due</td>
<td style="padding:16px 0;text-align:right;font-size:20px;font-weight:700;color:${E_TEAL};">${escapeHtml(totalStr)}</td></tr>
</table>
<p style="margin:28px 0 0;font-size:14px;color:${E_SLATE};">If anything looks wrong, reply to this email or contact the studio.</p>
<p style="margin:20px 0 0;font-size:14px;color:${E_TEAL_DK};font-weight:600;">— Heigen Studio</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;

    return { subject, plain, html };
}
