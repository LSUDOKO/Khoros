/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The workspace packages ship TypeScript source rather than a build step.
  transpilePackages: ["@khoros/core", "@khoros/scoring", "@khoros/ui"],
};

export default nextConfig;
