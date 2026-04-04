/** @type {import('next').NextConfig} */
const nextConfig = {
  // API routes have a 30s timeout per the spec
  experimental: {
    serverActions: {
      bodySizeLimit: '1mb',
    },
  },
}

module.exports = nextConfig
