/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output so the Docker image is small and self-contained.
  output: 'standalone',
  reactStrictMode: true,
  eslint: {
    // CI runs `make lint` explicitly; don't fail `next build` on lint.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
