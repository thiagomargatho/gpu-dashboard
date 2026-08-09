import { readFile, readdir } from 'node:fs/promises';
import { getConfig } from './config.js';

const CLOCK_TICK = 100; // USER_HZ no Linux x86_64
const PAGE_SIZE = 4096; // x86_64
let bootTimeSeconds = null;

function baseUrl() {
  const { host, port } = getConfig().ollama;
  return `http://${host}:${port}`;
}

async function getJson(path, timeoutMs = 3000) {
  const res = await fetch(`${baseUrl()}${path}`, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function readBootTime() {
  if (bootTimeSeconds != null) return bootTimeSeconds;
  try {
    const stat = await readFile('/proc/stat', 'utf8');
    const m = stat.match(/^btime\s+(\d+)/m);
    bootTimeSeconds = m ? Number(m[1]) : null;
  } catch {
    bootTimeSeconds = null;
  }
  return bootTimeSeconds;
}

/** CPU% por processo tambem precisa de delta entre coletas. */
const prevProcCpu = new Map();

async function readProcess(pid) {
  let stat;
  let cmdline = '';
  try {
    stat = await readFile(`/proc/${pid}/stat`, 'utf8');
    cmdline = (await readFile(`/proc/${pid}/cmdline`, 'utf8')).replace(/\0/g, ' ').trim();
  } catch {
    return null; // processo terminou no meio da leitura
  }

  // O comm vem entre parenteses e pode conter espacos: corta no ultimo ')'.
  const close = stat.lastIndexOf(')');
  const comm = stat.slice(stat.indexOf('(') + 1, close);
  const fields = stat.slice(close + 2).split(' ');

  const utime = Number(fields[11]);
  const stime = Number(fields[12]);
  const starttime = Number(fields[19]);
  const rssPages = Number(fields[21]);
  const totalTicks = utime + stime;

  const now = Date.now();
  const prev = prevProcCpu.get(pid);
  prevProcCpu.set(pid, { ticks: totalTicks, at: now });

  let cpuPercent = null;
  if (prev && now > prev.at) {
    const elapsedSec = (now - prev.at) / 1000;
    cpuPercent = +(((totalTicks - prev.ticks) / CLOCK_TICK / elapsedSec) * 100).toFixed(1);
    if (cpuPercent < 0) cpuPercent = null;
  }

  const btime = await readBootTime();
  const startedAtSec = btime != null ? btime + starttime / CLOCK_TICK : null;

  return {
    pid,
    name: comm,
    cmdline: cmdline || comm,
    cpuPercent,
    rssBytes: Number.isFinite(rssPages) ? rssPages * PAGE_SIZE : null,
    uptimeSeconds: startedAtSec ? Math.round(Date.now() / 1000 - startedAtSec) : null,
  };
}

/** Varre /proc procurando os processos do Ollama. Sem `ps`, sem shell. */
export async function ollamaProcesses() {
  let entries;
  try {
    entries = await readdir('/proc');
  } catch {
    return [];
  }

  const found = [];
  const livePids = new Set();
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    let comm;
    try {
      comm = (await readFile(`/proc/${pid}/comm`, 'utf8')).trim();
    } catch {
      continue;
    }
    if (!/^(ollama|llama-server|ollama-runner)$/.test(comm)) continue;
    const info = await readProcess(pid);
    if (info) {
      livePids.add(pid);
      found.push(info);
    }
  }

  for (const pid of prevProcCpu.keys()) {
    if (!livePids.has(pid)) prevProcCpu.delete(pid);
  }
  return found.sort((a, b) => a.pid - b.pid);
}

export async function sampleOllama() {
  const url = baseUrl();
  let version = null;
  let online = false;
  let error = null;

  try {
    const v = await getJson('/api/version', 2000);
    version = v?.version ?? null;
    online = true;
  } catch (err) {
    error = err.name === 'TimeoutError' ? 'sem resposta (timeout)' : err.message;
  }

  let models = [];
  let loaded = [];
  if (online) {
    try {
      const tags = await getJson('/api/tags', 5000);
      models = (tags?.models ?? []).map((m) => ({
        name: m.name,
        sizeBytes: m.size ?? null,
        modifiedAt: m.modified_at ?? null,
        family: m.details?.family ?? null,
        parameterSize: m.details?.parameter_size ?? null,
        quantization: m.details?.quantization_level ?? null,
        format: m.details?.format ?? null,
        contextLength: m.details?.context_length ?? null,
        parentModel: m.details?.parent_model || null,
        capabilities: m.capabilities ?? [],
      })).sort((a, b) => a.name.localeCompare(b.name));
    } catch (err) {
      error = `/api/tags falhou: ${err.message}`;
    }

    try {
      const ps = await getJson('/api/ps', 5000);
      loaded = (ps?.models ?? []).map((m) => ({
        name: m.name,
        sizeBytes: m.size ?? null,
        vramBytes: m.size_vram ?? 0,
        // size_vram = 0 com o modelo carregado significa residente em RAM.
        placement: m.size_vram > 0 ? (m.size_vram >= (m.size ?? 0) ? 'gpu' : 'hibrido') : 'cpu',
        contextLength: m.context_length ?? null,
        expiresAt: m.expires_at ?? null,
        quantization: m.details?.quantization_level ?? null,
        parameterSize: m.details?.parameter_size ?? null,
      }));
    } catch (err) {
      error = `/api/ps falhou: ${err.message}`;
    }
  }

  const procs = await ollamaProcesses();

  return {
    online,
    url,
    version,
    error,
    models,
    loaded,
    processes: procs,
    cpuPercent: procs.length ? +procs.reduce((a, p) => a + (p.cpuPercent ?? 0), 0).toFixed(1) : null,
    rssBytes: procs.length ? procs.reduce((a, p) => a + (p.rssBytes ?? 0), 0) : null,
    uptimeSeconds: procs.length ? Math.max(...procs.map((p) => p.uptimeSeconds ?? 0)) : null,
  };
}
