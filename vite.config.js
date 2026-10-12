import { defineConfig } from 'vite';
// base './' để chạy được cả ở thư mục con (GitHub Pages) lẫn gốc (Vercel/Render)
export default defineConfig({ base: './', build: { outDir: 'dist', target: 'es2020' } });
