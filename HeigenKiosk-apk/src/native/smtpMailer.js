import { NativeModules, Platform } from "react-native";

const { SmtpMailer } = NativeModules;

export function isSmtpMailerAvailable() {
    return Platform.OS === "android" && SmtpMailer?.sendMail != null;
}

function envBool(name, defaultTrue = true) {
    const raw = String(process.env[name] ?? "").trim().toLowerCase();
    if (!raw) return defaultTrue;
    return !["0", "false", "no"].includes(raw);
}

/** SMTP settings embedded at APK build (same HEIGEN_SMTP_* / EMAIL_* as Snaplytics). */
export function getSmtpConfigFromEnv() {
    const host =
        String(process.env.EXPO_PUBLIC_SMTP_HOST || "").trim() ||
        String(process.env.EXPO_PUBLIC_HEIGEN_SMTP_HOST || "").trim() ||
        "smtp.gmail.com";
    const port = parseInt(
        String(
            process.env.EXPO_PUBLIC_SMTP_PORT ||
                process.env.EXPO_PUBLIC_HEIGEN_SMTP_PORT ||
                "587",
        ),
        10,
    );
    const user =
        String(process.env.EXPO_PUBLIC_SMTP_USER || "").trim() ||
        String(process.env.EXPO_PUBLIC_HEIGEN_SMTP_USERNAME || "").trim() ||
        String(process.env.EXPO_PUBLIC_EMAIL_HOST_USER || "").trim();
    const password = String(
        process.env.EXPO_PUBLIC_SMTP_PASSWORD ||
            process.env.EXPO_PUBLIC_HEIGEN_SMTP_PASSWORD ||
            process.env.EXPO_PUBLIC_EMAIL_HOST_PASSWORD ||
            "",
    )
        .trim()
        .replace(/\s+/g, "");
    const fromEmail =
        String(process.env.EXPO_PUBLIC_SMTP_FROM_EMAIL || "").trim() ||
        String(process.env.EXPO_PUBLIC_HEIGEN_SMTP_FROM_EMAIL || "").trim() ||
        String(process.env.EXPO_PUBLIC_DEFAULT_FROM_EMAIL || "").trim() ||
        user;
    const fromName =
        String(process.env.EXPO_PUBLIC_SMTP_FROM_NAME || "").trim() ||
        String(process.env.EXPO_PUBLIC_HEIGEN_SMTP_SENDER_NAME || "").trim() ||
        "Heigen Studio";
    const useTls = envBool("EXPO_PUBLIC_SMTP_USE_TLS", true);
    if (!host || !user || !password || !fromEmail) {
        return null;
    }
    return { host, port, user, password, fromEmail, fromName, useTls };
}

export function isSmtpConfigured() {
    return isSmtpMailerAvailable() && getSmtpConfigFromEnv() != null;
}

/**
 * @param {{ to: string, subject: string, plain: string, html: string }} mail
 */
export async function sendKioskSmtpEmail(mail) {
    const cfg = getSmtpConfigFromEnv();
    if (!cfg) {
        throw new Error(
            "SMTP not configured. Set EXPO_PUBLIC_SMTP_HOST, EXPO_PUBLIC_SMTP_USER, EXPO_PUBLIC_SMTP_PASSWORD (and FROM) in .env before building the APK.",
        );
    }
    if (!isSmtpMailerAvailable()) {
        throw new Error("SmtpMailer native module missing (Android release build only).");
    }
    const to = String(mail.to || "").trim();
    if (!to) {
        throw new Error("Recipient email is required.");
    }
    return SmtpMailer.sendMail(
        cfg.host,
        cfg.port,
        cfg.user,
        cfg.password,
        cfg.useTls,
        cfg.fromEmail,
        cfg.fromName,
        to,
        mail.subject || "Heigen Studio booking",
        mail.plain || "",
        mail.html || mail.plain || "",
    );
}
