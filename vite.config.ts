import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      'tmbwa-shared/firebase': path.resolve(
        __dirname,
        'packages/shared/src/firebase.ts',
      ),
      'tmbwa-shared': path.resolve(__dirname, 'packages/shared/src/index.ts'),
    },
  },
  plugins: [react()],
});
