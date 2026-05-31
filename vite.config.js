import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import vercel from 'vite-plugin-vercel';

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [
    react(),
    mode === 'vercel' && vercel({
      rewrites: [
        {
          source: '/((?!api/.*).*)',
          destination: '/index.html',
        },
      ],
    }),
  ].filter(Boolean),
}));
