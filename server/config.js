import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = join(ROOT, 'config.json');

const DEFAULTS = {
  port: 8099,
  host: '0.0.0.0',
  ollama: { host: '127.0.0.1', port: 11434 },
  collect: { intervalMs: 2000, historyMinutes: 60 },
  alerts: {
    gpuTempC: 80,
    gpuVramPercent: 95,
    gpuUtilPercent: 95,
    gpuUtilSustainedSeconds: 300,
    gpuPowerPercent: 95,
    ramPercent: 90,
    diskFreePercent: 10,
  },
  energy: { pricePerKwh: 0.95, currency: 'R$' },
  disk: { mount: '/' },
  log: { file: 'logs/gpu-dashboard.log', maxBytes: 2 * 1024 * 1024, keep: 3 },
};

// Somente estas chaves podem ser gravadas pela UI, e cada uma dentro da sua faixa.
// Porta, host e caminhos ficam de fora de proposito: mudar isso pela rede seria
// dar ao navegador poder de reconfigurar o processo.
const EDITABLE = {
  'energy.pricePerKwh': { min: 0, max: 100 },
  'alerts.gpuTempC': { min: 40, max: 110 },
  'alerts.gpuVramPercent': { min: 50, max: 100 },
  'alerts.gpuUtilPercent': { min: 50, max: 100 },
  'alerts.gpuUtilSustainedSeconds': { min: 10, max: 3600 },
  'alerts.gpuPowerPercent': { min: 50, max: 100 },
  'alerts.ramPercent': { min: 50, max: 100 },
  'alerts.diskFreePercent': { min: 1, max: 50 },
};

function deepMerge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(base[k] || {}, v) : v;
  }
  return out;
}

let current = DEFAULTS;

export function loadConfig() {
  try {
    current = deepMerge(DEFAULTS, JSON.parse(readFileSync(CONFIG_PATH, 'utf8')));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`config.json invalido (${err.message}) — usando os padroes`);
    }
    current = DEFAULTS;
  }
  return current;
}

export function getConfig() {
  return current;
}

export function editableKeys() {
  return EDITABLE;
}

/**
 * Aplica um patch vindo da UI. Devolve { ok, applied, errors }.
 * Qualquer chave fora da allowlist e recusada, e qualquer valor fora de faixa
 * tambem — nada aqui confia no que o navegador mandou.
 */
export function updateConfig(patch) {
  const errors = [];
  const applied = {};

  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { ok: false, applied, errors: ['corpo da requisicao precisa ser um objeto'] };
  }

  for (const [key, raw] of Object.entries(patch)) {
    const rule = EDITABLE[key];
    if (!rule) {
      errors.push(`"${key}" nao e editavel`);
      continue;
    }
    // Numero de verdade apenas: Number(true)=1 e Number('')=0 nao podem entrar.
    if (typeof raw === 'boolean' || raw === null || raw === undefined
      || (typeof raw === 'string' && raw.trim() === '')) {
      errors.push(`"${key}" precisa ser um numero`);
      continue;
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      errors.push(`"${key}" precisa ser numerico`);
      continue;
    }
    if (value < rule.min || value > rule.max) {
      errors.push(`"${key}" fora da faixa ${rule.min}–${rule.max}`);
      continue;
    }
    applied[key] = value;
  }

  if (errors.length) return { ok: false, applied: {}, errors };

  const next = deepMerge(current, {});
  for (const [key, value] of Object.entries(applied)) {
    const [group, field] = key.split('.');
    next[group] = { ...next[group], [field]: value };
  }

  writeFileSync(CONFIG_PATH, `${JSON.stringify(next, null, 2)}\n`);
  current = next;
  return { ok: true, applied, errors };
}
