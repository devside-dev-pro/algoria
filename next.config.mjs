/** @type {import('next').NextConfig} */
const nextConfig = {
  // /backtest a circulé (Telegram, WhatsApp) quand la page montrait une simulation. Elle montre désormais le
  // vrai compte sous /track-record (24/09/2026) : redirection PERMANENTE, pour qu'aucun lien partagé ne casse.
  async redirects() {
    return [{ source: '/backtest', destination: '/track-record', permanent: true }];
  },
};

export default nextConfig;
