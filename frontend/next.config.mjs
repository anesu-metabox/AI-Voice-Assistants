/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    const backendUrl = process.env.BACKEND_URL || "http://127.0.0.1:8000";
    return [{
      source: "/auth/google/:path*",
      destination: `${backendUrl}/auth/google/:path*`,
    }];
  },
};

export default nextConfig;
