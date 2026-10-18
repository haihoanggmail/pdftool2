import { defineConfig } from 'vite';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import trackHandler from './api/track.js';
import statsHandler from './api/stats.js';

function apiPlugin() {
  return {
    name: 'api-handlers',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        if (url.pathname === '/api/track') {
          let body = '';
          req.on('data', (chunk) => { body += chunk; });
          req.on('end', async () => {
            req.body = body;
            const resMock = {
              status(code) { res.statusCode = code; return this; },
              json(data) {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(data));
                return this;
              },
              setHeader(k, v) { res.setHeader(k, v); return this; },
            };
            try {
              await trackHandler(req, resMock);
            } catch (err) {
              resMock.status(500).json({ ok: false, error: err.message });
            }
          });
          return;
        }
        if (url.pathname === '/api/stats') {
          req.query = Object.fromEntries(url.searchParams.entries());
          const resMock = {
            status(code) { res.statusCode = code; return this; },
            json(data) {
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify(data));
              return this;
            },
            setHeader(k, v) { res.setHeader(k, v); return this; },
          };
          try {
            await statsHandler(req, resMock);
          } catch (err) {
            resMock.status(500).json({ ok: false, error: err.message });
          }
          return;
        }
        next();
      });
    },
  };
}


// Gắn mã bản dựng vào service worker: mỗi lần `npm run build` ra một phiên bản bộ nhớ mới (xem public/sw.js)
function swVersionPlugin() {
  let outDir = 'dist';
  return {
    name: 'sw-build-version',
    apply: 'build',
    configResolved(cfg) { outDir = cfg.build.outDir; },
    closeBundle() {
      const file = join(outDir, 'sw.js');
      if (!existsSync(file)) return;
      const stamp = (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 8) || Date.now().toString(36);
      writeFileSync(file, readFileSync(file, 'utf8').replace(/__BUILD__/g, stamp));
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [apiPlugin(), swVersionPlugin()],
  server: {
    host: '0.0.0.0',
    port: 3000,
  },
  preview: {
    host: '0.0.0.0',
    port: 3000,
  },
  build: {
    outDir: 'dist',
    target: 'es2020',
  },
});
