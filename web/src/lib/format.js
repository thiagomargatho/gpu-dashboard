export const NA = '—';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * VRAM, RAM e disco em base binária (é o que `nvidia-smi`, `free -h` e `df -h`
 * mostram). Tamanhos de modelo do Ollama usam base decimal — é o que o
 * `ollama list` imprime, e a ideia é bater com o que você já vê no terminal.
 */
export function bytes(value, { binary = true, digits } = {}) {
  if (!isNum(value)) return NA;
  const k = binary ? 1024 : 1000;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = value;
  let i = 0;
  while (Math.abs(v) >= k && i < units.length - 1) {
    v /= k;
    i += 1;
  }
  const d = digits ?? (i >= 3 ? (v >= 100 ? 0 : 1) : 0);
  return `${v.toFixed(d)} ${units[i]}`;
}

/** Só o número, para pares "usado / total" sem repetir a unidade. */
export function bytesNum(value, { binary = true, digits = 1 } = {}) {
  if (!isNum(value)) return NA;
  const k = binary ? 1024 : 1000;
  let v = value;
  let i = 0;
  while (Math.abs(v) >= k && i < 4) {
    v /= k;
    i += 1;
  }
  return v.toFixed(digits);
}

export function mib(value, digits = 1) {
  return isNum(value) ? (value / 1024).toFixed(digits) : NA;
}

export function pct(value, digits = 0) {
  return isNum(value) ? `${value.toFixed(digits)}%` : NA;
}

export function num(value, digits = 0, suffix = '') {
  return isNum(value) ? `${value.toFixed(digits)}${suffix}` : NA;
}

export function duration(seconds) {
  if (!isNum(seconds) || seconds < 0) return NA;
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}min`;
  if (m > 0) return `${m}min`;
  return `${Math.floor(seconds)}s`;
}

export function dateTime(iso) {
  if (!iso) return NA;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return NA;
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

/**
 * `keep_alive: -1` vira um expires_at no ano 2318. Mostrar "faltam 106 mil dias"
 * seria tecnicamente correto e completamente inútil.
 */
export function expiry(iso) {
  if (!iso) return NA;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return NA;
  const deltaSec = (d.getTime() - Date.now()) / 1000;
  if (deltaSec > 365 * 86400) return 'Permanente';
  if (deltaSec <= 0) return 'expirando';
  return duration(deltaSec);
}

export function money(value, currency = 'R$') {
  if (!isNum(value)) return NA;
  return `${currency} ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function clockTime(ts) {
  return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/* ---- classificação de estado (item 9 do escopo: poucas cores, sem exagero) ---- */

export function tempLevel(c, limit = 80) {
  if (!isNum(c)) return 'idle';
  if (c >= limit) return 'bad';
  if (c >= limit - 12) return 'warn';
  return 'ok';
}

export function vramLevel(p, limit = 95) {
  if (!isNum(p)) return 'idle';
  if (p >= limit) return 'bad';
  if (p >= 80) return 'warn';
  return 'ok';
}

export function utilLevel(p) {
  if (!isNum(p)) return 'idle';
  if (p >= 90) return 'warn';
  if (p >= 5) return 'ok';
  return 'idle';
}

export function powerLevel(p, limit = 95) {
  if (!isNum(p)) return 'idle';
  if (p >= limit) return 'warn';
  return 'ok';
}

export const LEVEL_TEXT = {
  ok: 'Normal',
  warn: 'Atenção',
  bad: 'Crítico',
  idle: 'N/A',
};

export const UTIL_TEXT = {
  idle: 'Ocioso',
  ok: 'Em uso',
  warn: 'Carga alta',
  bad: 'Carga alta',
};

export const VRAM_TEXT = {
  ok: 'Normal',
  warn: 'Alta utilização',
  bad: 'Crítica',
  idle: 'N/A',
};

export function levelColor(level) {
  return {
    ok: 'var(--green)',
    warn: 'var(--amber)',
    bad: 'var(--red)',
    idle: 'var(--text-faint)',
  }[level] ?? 'var(--text-faint)';
}
