import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ROOT, getConfig } from './config.js';

let logPath = null;

function ensurePath() {
  if (logPath) return logPath;
  const cfg = getConfig().log;
  logPath = join(ROOT, cfg.file);
  mkdirSync(dirname(logPath), { recursive: true });
  return logPath;
}

function rotateIfNeeded() {
  const cfg = getConfig().log;
  let size = 0;
  try {
    size = statSync(logPath).size;
  } catch {
    return;
  }
  if (size < cfg.maxBytes) return;

  // gpu-dashboard.log -> .1 -> .2 -> ... -> descartado
  try {
    rmSync(`${logPath}.${cfg.keep}`, { force: true });
    for (let i = cfg.keep - 1; i >= 1; i -= 1) {
      try {
        renameSync(`${logPath}.${i}`, `${logPath}.${i + 1}`);
      } catch { /* arquivo intermediario ainda nao existe */ }
    }
    renameSync(logPath, `${logPath}.1`);
  } catch (err) {
    console.error(`falha ao rotacionar log: ${err.message}`);
  }
}

/** level: info | warn | error */
export function log(level, message) {
  const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${message}\n`;
  process.stdout.write(line);
  try {
    ensurePath();
    rotateIfNeeded();
    appendFileSync(logPath, line);
  } catch (err) {
    process.stderr.write(`nao foi possivel gravar no log: ${err.message}\n`);
  }
}

/**
 * Registra apenas a MUDANCA de estado, nao o estado.
 * Sem isso um "Ollama offline" a cada 2s enche o disco em minutos.
 */
const lastState = new Map();
export function logTransition(key, state, level, message) {
  if (lastState.get(key) === state) return;
  const first = !lastState.has(key);
  lastState.set(key, state);
  if (first && level === 'info') return; // nao ruidar no boot com o estado normal
  log(level, message);
}
