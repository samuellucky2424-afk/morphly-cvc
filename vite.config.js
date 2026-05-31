import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  base: './',
  publicDir: mode === 'vercel' ? false : 'public',
  plugins: [react()],
}));
