// Extends app.json. Set KIOSK_BASE_URL (e.g. "/kiosk") when exporting the web
// build to be served under a sub-path, such as the Electron web server's /kiosk/.
module.exports = ({ config }) => {
  const baseUrl = String(process.env.KIOSK_BASE_URL || '').replace(/\/+$/, '');
  if (!baseUrl) return config;
  return {
    ...config,
    experiments: { ...(config.experiments || {}), baseUrl },
  };
};
