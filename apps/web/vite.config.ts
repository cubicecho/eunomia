import { defineConfig } from 'vite';

// The dashboard talks to a relative /graphql, proxied here in dev so tokens
// never cross origins. Point EUNOMIA_SERVER_URL elsewhere to develop against
// a remote server.
export default defineConfig({
  server: {
    proxy: {
      '/graphql': process.env.EUNOMIA_SERVER_URL ?? 'http://localhost:4000',
    },
  },
});
