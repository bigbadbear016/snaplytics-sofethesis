/** Embed .env into Expo extra (release APK gradle bundle reads this reliably). */
require("dotenv").config();

const appJson = require("./app.json");

module.exports = ({ config }) => ({
    ...appJson.expo,
    ...config,
    extra: {
        ...(config?.extra || {}),
        smtpHost: process.env.EXPO_PUBLIC_SMTP_HOST || "",
        smtpUser: process.env.EXPO_PUBLIC_SMTP_USER || "",
    },
});
