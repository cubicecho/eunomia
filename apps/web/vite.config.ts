import { defineConfig } from 'vite';

// The dashboard talks to a relative /graphql, proxied here in dev so tokens
// never cross origins. Point EUNOMIA_SERVER_URL elsewhere to develop against
// a remote server.
export default defineConfig({
  server: {
    // Listen on all interfaces — dev often runs on a VM/remote docker host,
    // where vite's localhost-only default would be unreachable.
    host: true,
    proxy: {
      '/graphql': process.env.EUNOMIA_SERVER_URL ?? 'http://localhost:4000',
    },
  },
});
