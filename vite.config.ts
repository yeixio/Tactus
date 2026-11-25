import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
  build: { outDir: 'dist', target: 'es2022' },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
} as any)
