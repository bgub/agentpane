/** @type {import('next').NextConfig} */
export default {
  output: 'standalone',
  reactCompiler: true,
  transpilePackages: ['@streamdown/code', 'shiki'],
  async rewrites() {
    return [{ source: '/api/:path*', destination: 'http://localhost:3456/api/:path*' }]
  },
}
