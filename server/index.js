import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { ROOT, editableKeys, getConfig, loadConfig, updateConfig } from './config.js';
import { log } from './logger.js';
import * as collector from './collector.js';

loadConfig();
const cfg = getConfig();

const WEB_DIR = join(ROOT, 'web', 'dist');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const RANGES = { '5m': 5, '15m': 15, '30m': 30, '60m': 60, '1h': 60 };

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req, limitBytes = 8 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error('corpo grande demais'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  if (!existsSync(WEB_DIR)) {
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Frontend ainda nao foi compilado. Rode: npm run build\n');
    return;
  }

  // normalize + prefixo obrigatorio: bloqueia ../../etc/passwd.
  const rel = normalize(pathname === '/' ? '/index.html' : pathname).replace(/^(\.\.[/\\])+/, '');
  let file = join(WEB_DIR, rel);
  if (!file.startsWith(WEB_DIR)) {
    res.writeHead(403).end();
    return;
  }

  // SPA: rota desconhecida cai no index.html, e o roteador do frontend resolve.
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(WEB_DIR, 'index.html');

  const ext = extname(file);
  res.writeHead(200, {
    'content-type': MIME[ext] || 'application/octet-stream',
    'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=86400',
  });
  createReadStream(file).pipe(res);
}

const server = createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch {
    res.writeHead(400).end();
    return;
  }
  const path = url.pathname;

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.writeHead(405, { allow: 'GET, POST' }).end();
    return;
  }

  // ---- API ----------------------------------------------------------------
  if (path === '/api/health') {
    const snap = collector.currentSnapshot();
    const gpus = snap?.gpus ?? [];
    sendJson(res, 200, {
      status: snap ? 'ok' : 'starting',
      ollama: snap?.ollama.online ?? false,
      nvidia: gpus.some((g) => g.status === 'ok'),
      gpu_count: gpus.length,
      gpu_online: gpus.filter((g) => g.status === 'ok').length,
      uptime_seconds: snap?.collectorUptimeSeconds ?? 0,
      alerts: snap?.alerts.length ?? 0,
    });
    return;
  }

  if (path === '/api/metrics') {
    const snap = collector.currentSnapshot();
    if (!snap) {
      sendJson(res, 503, { error: 'primeira coleta ainda nao concluiu' });
      return;
    }
    sendJson(res, 200, snap);
    return;
  }

  if (path === '/api/history') {
    const raw = url.searchParams.get('range') ?? '15m';
    const minutes = RANGES[raw];
    if (!minutes) {
      sendJson(res, 400, { error: `range invalido. use: ${Object.keys(RANGES).join(', ')}` });
      return;
    }
    sendJson(res, 200, { range: raw, minutes, series: collector.history(minutes) });
    return;
  }

  if (path === '/api/config') {
    if (req.method === 'GET') {
      const c = getConfig();
      sendJson(res, 200, {
        // porta/host/caminhos sao informativos: mudar exige editar o arquivo e reiniciar
        readOnly: { port: c.port, host: c.host, ollama: c.ollama, collect: c.collect, disk: c.disk, log: c.log },
        editable: { energy: c.energy, alerts: c.alerts },
        limits: editableKeys(),
      });
      return;
    }
    let patch;
    try {
      patch = JSON.parse(await readBody(req));
    } catch (err) {
      sendJson(res, 400, { error: `JSON invalido: ${err.message}` });
      return;
    }
    const result = updateConfig(patch);
    if (!result.ok) {
      sendJson(res, 400, { error: 'configuracao recusada', details: result.errors });
      return;
    }
    log('info', `configuracao alterada: ${JSON.stringify(result.applied)}`);
    sendJson(res, 200, { ok: true, applied: result.applied });
    return;
  }

  if (path === '/api/stream') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write(`retry: 3000\n\n`);
    const unsubscribe = collector.subscribe(res);
    // Comentario SSE periodico: mantem proxies e NAT de LAN sem derrubar a conexao.
    const ping = setInterval(() => {
      try { res.write(': ping\n\n'); } catch { /* fechado */ }
    }, 20000);
    req.on('close', () => {
      clearInterval(ping);
      unsubscribe();
    });
    return;
  }

  if (path.startsWith('/api/')) {
    sendJson(res, 404, { error: 'endpoint inexistente' });
    return;
  }

  // ---- Frontend -----------------------------------------------------------
  if (req.method !== 'GET') {
    res.writeHead(405).end();
    return;
  }
  serveStatic(req, res, path);
});

server.listen(cfg.port, cfg.host, () => {
  log('info', `gpu-dashboard ouvindo em http://${cfg.host}:${cfg.port}`);
  collector.start();
});

function shutdown(signal) {
  log('info', `recebido ${signal} — encerrando`);
  collector.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  log('error', `excecao nao tratada: ${err.stack || err.message}`);
});
