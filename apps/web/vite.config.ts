import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The dashboard talks to a relative /graphql, proxied here in dev so tokens
// never cross origins. Point EUNOMIA_SERVER_URL elsewhere to develop against
// a remote server.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    // The workspace root hoists an older react for the Expo app, so radix and
    // recharts can end up importing a second copy — which makes every hook
    // call throw. One copy, always.
    dedupe: ['react', 'react-dom'],
  },
  server: {
    // Listen on all interfaces — dev often runs on a VM/remote docker host,
    // where vite's localhost-only default would be unreachable.
    host: true,
    port: 3000,
    proxy: {
      '/graphql': process.env.EUNOMIA_SERVER_URL ?? 'http://localhost:4000',
    },
  },
});
