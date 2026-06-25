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
}));
