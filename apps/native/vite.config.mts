import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const resolverExtensions = [
  '.web.tsx',
  '.web.ts',
  '.web.jsx',
  '.web.js',
  '.tsx',
  '.ts',
  '.jsx',
  '.js',
  '.json',
];

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: {
    __DEV__: JSON.stringify(mode !== 'production'),
    // react-native-web's Animated references `global`; map it to globalThis so
    // animated widgets don't crash in the browser.
    global: 'globalThis',
    'process.env.NODE_ENV': JSON.stringify(
      mode === 'production' ? 'production' : 'development',
    ),
  },
  resolve: {
    alias: [
      { find: /^react-native$/, replacement: 'react-native-web' },
      {
        find: /^react-native-safe-area-context$/,
        replacement: path.resolve(__dirname, 'src/platform/safeAreaContext.web.tsx'),
      },
    ],
    extensions: resolverExtensions,
  },
  build: {
    outDir: '.web-build',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      // Forward API + SSE to the Go backend so the browser stays same-origin.
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
}));
