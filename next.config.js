/** @type {import('next').NextConfig} */
const nextConfig = {
  // API routes have a 30s timeout per the spec
  experimental: {
    serverActions: {
      bodySizeLimit: '1mb',
    },
  },
  // Serve the static HTML landing page at the root
  async rewrites() {
    return [
      {
        source: '/',
        destination: '/index.html',
      },
    ]
  },
}

module.exports = nextConfig
