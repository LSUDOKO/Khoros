/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // The workspace packages ship TypeScript source rather than a build step.
  transpilePackages: ["@khoros/core", "@khoros/scoring", "@khoros/ui"],

  webpack(config) {
    // Those packages are authored with `verbatimModuleSyntax`, so their
    // internal imports carry explicit `.js` extensions — correct for Node ESM
    // resolution, but webpack needs to be told that a `.js` specifier may
    // resolve to the `.ts`/`.tsx` source it was written in.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
