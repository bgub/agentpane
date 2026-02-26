/** @type {import('next').NextConfig} */
export default {
  output: 'standalone',
  reactCompiler: true,
  async rewrites() {
    return [{ source: '/api/:path*', destination: 'http://localhost:3456/api/:path*' }]
  },
}
