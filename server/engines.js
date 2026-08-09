import { readFile, readdir, stat } from 'node:fs/promises';
import { getConfig } from './config.js';

const CLOCK_TICK = 100;
const PAGE_SIZE = 4096;
let bootTimeSeconds = null;

// Token counting state persisted across collections
const tokenState = new Map(); // engine -> { model -> { promptTokens, completionTokens, totalTokens, lastUpdate } }

// Ollama log paths to check
const OLLAMA_LOG_PATHS = [
  '/var/log/ollama.log',
  '/var/log/syslog',
  '/home/*/.ollama/logs/*.log',
  '/root/.ollama/logs/*.log',
];

const ENGINE_COMMANDS = {
  ollama: ['ollama', 'llama-server', 'ollama-runner'],
  vllm: ['vllm', 'python -m vllm'],
  tgi: ['text-generation-launcher', 'text-generation-router', 'tgi'],
  llamaCpp: ['llama-server', 'llama-cli', 'llama-bench', 'llama-embedding'],
  localai: ['local-ai', 'localai'],
  koboldcpp: ['koboldcpp', 'koboldcpp_cuda', 'koboldcpp_avx2'],
};

const ENGINE_API = {
  ollama: {
    version: '/api/version',
    models: '/api/tags',
    loaded: '/api/ps',
    health: '/api/version',
  },
  vllm: {
    version: '/health',
    models: '/v1/models',
    loaded: null,
    health: '/health',
  },
  tgi: {
    version: '/health',
    models: '/info',
    loaded: null,
    health: '/health',
  },
  llamaCpp: {
    version: '/health',
    models: '/v1/models',
    loaded: '/slots',
    health: '/health',
  },
  localai: {
    version: '/health',
    models: '/v1/models',
    loaded: null,
    health: '/health',
  },
  koboldcpp: {
    version: '/api/version',
    models: '/api/model',
    loaded: null,
    health: '/api/version',
  },
};

function engineBaseUrl(engine) {
  const cfg = getConfig()[engine];
  return `http://${cfg.host}:${cfg.port}`;
}

async function getJson(url, timeoutMs = 3000) {
  const res = await fetch(url, {
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

/** Parse Ollama logs for token counts. Ollama logs lines like:
 *  "eval_tokens=123 prompt_eval_tokens=456"
 *  or JSON: {"level":"info","msg":"generate","prompt_eval_count":456,"eval_count":123}
 */
async function parseOllamaTokens(engineProcs) {
  const tokensByModel = new Map();
  
  // Try to get from /api/ps which may have token info in newer versions
  // For now, parse logs
  for (const proc of engineProcs) {
    try {
      // Check journalctl for ollama service
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const execFileAsync = promisify(execFile);
      
      // Try journalctl for the specific PID
      const result = await execFileAsync('journalctl', [
        '-u', 'ollama',
        '--since', '5 minutes ago',
        '-o', 'json',
        '-q'
      ], { timeout: 3000, encoding: 'utf8' });
      
      for (const line of result.stdout.split('\n')) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          const msg = entry.MESSAGE || entry.msg || '';
          
          // Parse various log formats
          // Format 1: "eval_tokens=123 prompt_eval_tokens=456 model=qwen3.5:4b"
          const modelMatch = msg.match(/model[=:]?\s*([^\s,]+)/i);
          const evalMatch = msg.match(/eval[_-]?(?:tokens|count)[=:]?\s*(\d+)/i);
          const promptMatch = msg.match(/prompt[_-]?eval[_-]?(?:tokens|count)[=:]?\s*(\d+)/i);
          
          if (modelMatch && (evalMatch || promptMatch)) {
            const model = modelMatch[1].replace(/['"]/g, '');
            const completion = evalMatch ? parseInt(evalMatch[1]) : 0;
            const prompt = promptMatch ? parseInt(promptMatch[1]) : 0;
            
            if (!tokensByModel.has(model)) {
              tokensByModel.set(model, { promptTokens: 0, completionTokens: 0, totalTokens: 0 });
            }
            const t = tokensByModel.get(model);
            t.completionTokens += completion;
            t.promptTokens += prompt;
            t.totalTokens += completion + prompt;
          }
        } catch {
          // Not JSON, try plain text parsing
        }
      }
    } catch {
      // journalctl not available or no permission
    }
  }
  
  return tokensByModel;
}

/** Parse vLLM Prometheus metrics for token counts */
async function parseVLLMTokens(baseUrl) {
  const tokensByModel = new Map();
  try {
    const res = await fetch(`${baseUrl}/metrics`, { signal: AbortSignal.timeout(3000) });
    const text = await res.text();
    
    // vLLM exports: vllm:request_prompt_tokens_total{model="xxx"} 123
    //              vllm:request_completion_tokens_total{model="xxx"} 456
    for (const line of text.split('\n')) {
      if (line.startsWith('#') || !line.includes('tokens_total')) continue;
      
      const promptMatch = line.match(/vllm:request_prompt_tokens_total\{model="([^"]+)"\}\s+(\d+)/);
      const completionMatch = line.match(/vllm:request_completion_tokens_total\{model="([^"]+)"\}\s+(\d+)/);
      
      if (promptMatch) {
        const model = promptMatch[1];
        if (!tokensByModel.has(model)) tokensByModel.set(model, { promptTokens: 0, completionTokens: 0, totalTokens: 0 });
        tokensByModel.get(model).promptTokens = parseInt(promptMatch[2]);
      }
      if (completionMatch) {
        const model = completionMatch[1];
        if (!tokensByModel.has(model)) tokensByModel.set(model, { promptTokens: 0, completionTokens: 0, totalTokens: 0 });
        tokensByModel.get(model).completionTokens = parseInt(completionMatch[2]);
      }
    }
    
    for (const [model, t] of tokensByModel) {
      t.totalTokens = t.promptTokens + t.completionTokens;
    }
  } catch {
    // Ignore
  }
  return tokensByModel;
}

/** Parse TGI Prometheus metrics */
async function parseTGITokens(baseUrl) {
  const tokensByModel = new Map();
  try {
    const res = await fetch(`${baseUrl}/metrics`, { signal: AbortSignal.timeout(3000) });
    const text = await res.text();
    
    // TGI exports: tgi_request_prompt_tokens_total 123
    //              tgi_request_completion_tokens_total 456
    for (const line of text.split('\n')) {
      if (line.startsWith('#') || !line.includes('tokens_total')) continue;
      
      const promptMatch = line.match(/tgi_request_prompt_tokens_total\s+(\d+)/);
      const completionMatch = line.match(/tgi_request_completion_tokens_total\s+(\d+)/);
      
      if (promptMatch || completionMatch) {
        const model = 'current'; // TGI typically serves one model
        if (!tokensByModel.has(model)) tokensByModel.set(model, { promptTokens: 0, completionTokens: 0, totalTokens: 0 });
        if (promptMatch) tokensByModel.get(model).promptTokens = parseInt(promptMatch[1]);
        if (completionMatch) tokensByModel.get(model).completionTokens = parseInt(completionMatch[1]);
        tokensByModel.get(model).totalTokens = tokensByModel.get(model).promptTokens + tokensByModel.get(model).completionTokens;
      }
    }
  } catch {
    // Ignore
  }
  return tokensByModel;
}

/** Get token counts for an engine */
async function getEngineTokens(engine, procs, baseUrl) {
  if (engine === 'ollama') return parseOllamaTokens(procs);
  if (engine === 'vllm') return parseVLLMTokens(baseUrl);
  if (engine === 'tgi') return parseTGITokens(baseUrl);
  return new Map();
}

/** Calculate cost per token */
function calculateCostPerToken(energyWh, tokens, pricePerKwh) {
  if (!tokens || tokens === 0 || !energyWh) return null;
  const costPerKwh = pricePerKwh || 0.95;
  const costWh = (energyWh / 1000) * costPerKwh; // cost in currency for the energy used
  return costWh / tokens; // cost per token
}

const prevProcCpu = new Map();

async function readProcess(pid) {
  let stat;
  let cmdline = '';
  try {
    stat = await readFile(`/proc/${pid}/stat`, 'utf8');
    cmdline = (await readFile(`/proc/${pid}/cmdline`, 'utf8')).replace(/\0/g, ' ').trim();
  } catch {
    return null;
  }

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

async function engineProcesses(engine) {
  const commands = ENGINE_COMMANDS[engine] || [];
  if (!commands.length) return [];

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
    if (!commands.some((c) => comm.startsWith(c))) continue;
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

async function fetchEngine(engine) {
  const cfg = getConfig()[engine];
  if (!cfg.enabled) return { engine, online: false, enabled: false };

  const base = engineBaseUrl(engine);
  const api = ENGINE_API[engine];
  let version = null;
  let online = false;
  let error = null;
  let models = [];
  let loaded = [];

  try {
    const v = await getJson(`${base}${api.health}`, 2000);
    if (engine === 'ollama') version = v?.version ?? null;
    else if (engine === 'vllm') version = v?.version ?? 'unknown';
    else if (engine === 'tgi') version = v?.model_id ?? v?.model ?? 'unknown';
    else if (engine === 'llamaCpp') version = v?.version ?? 'unknown';
    else if (engine === 'localai') version = v?.version ?? 'unknown';
    else if (engine === 'koboldcpp') version = v?.version ?? 'unknown';
    online = true;
  } catch (err) {
    error = err.name === 'TimeoutError' ? 'sem resposta (timeout)' : err.message;
  }

  if (online) {
    try {
      if (api.models) {
        const m = await getJson(`${base}${api.models}`, 5000);
        if (engine === 'ollama') {
          models = (m?.models ?? []).map((mm) => ({
            name: mm.name,
            sizeBytes: mm.size ?? null,
            family: mm.details?.family ?? null,
            parameterSize: mm.details?.parameter_size ?? null,
            quantization: mm.details?.quantization_level ?? null,
            format: mm.details?.format ?? null,
            contextLength: mm.details?.context_length ?? null,
          })).sort((a, b) => a.name.localeCompare(b.name));
        } else if (engine === 'vllm' || engine === 'llamaCpp' || engine === 'localai') {
          models = (m?.data ?? []).map((mm) => ({
            name: mm.id,
            sizeBytes: null,
            family: mm.owned_by ?? null,
            parameterSize: null,
            quantization: null,
            format: mm.object ?? null,
            contextLength: mm.context_length ?? null,
          })).sort((a, b) => a.name.localeCompare(b.name));
        } else if (engine === 'tgi') {
          models = [{
            name: m?.model_id ?? m?.model ?? 'unknown',
            sizeBytes: null,
            family: m?.model_info?.model_type ?? null,
            parameterSize: null,
            quantization: m?.model_info?.quantization ?? null,
            format: null,
            contextLength: m?.model_info?.max_context_length ?? null,
          }];
        } else if (engine === 'koboldcpp') {
          models = [{
            name: m?.result ?? 'unknown',
            sizeBytes: null,
            family: null,
            parameterSize: null,
            quantization: null,
            format: null,
            contextLength: m?.context_size ?? null,
          }];
        }
      }

      if (api.loaded) {
        const ps = await getJson(`${base}${api.loaded}`, 5000);
        if (engine === 'ollama') {
          loaded = (ps?.models ?? []).map((mm) => ({
            name: mm.name,
            sizeBytes: mm.size ?? null,
            vramBytes: mm.size_vram ?? 0,
            placement: mm.size_vram > 0 ? (mm.size_vram >= (mm.size ?? 0) ? 'gpu' : 'hibrido') : 'cpu',
            contextLength: mm.context_length ?? null,
            quantization: mm.details?.quantization_level ?? null,
            parameterSize: mm.details?.parameter_size ?? null,
          }));
        } else if (engine === 'llamaCpp') {
          loaded = (ps?.slots ?? []).filter((s) => s.model).map((s) => ({
            name: s.model,
            sizeBytes: null,
            vramBytes: null,
            placement: 'gpu',
            contextLength: s.n_ctx ?? null,
            quantization: null,
            parameterSize: null,
          }));
        }
      }
    } catch (err) {
      error = `/models ou /loaded falhou: ${err.message}`;
    }
  }

  const procs = await engineProcesses(engine);

  // Get token counts
  const tokenCounts = await getEngineTokens(engine, procs, base);
  const tokensByModel = {};
  for (const [model, counts] of tokenCounts) {
    tokensByModel[model] = counts;
  }

  return {
    engine,
    enabled: true,
    online,
    url: base,
    version,
    error,
    models,
    loaded,
    processes: procs,
    cpuPercent: procs.length ? +procs.reduce((a, p) => a + (p.cpuPercent ?? 0), 0).toFixed(1) : null,
    rssBytes: procs.length ? procs.reduce((a, p) => a + (p.rssBytes ?? 0), 0) : null,
    uptimeSeconds: procs.length ? Math.max(...procs.map((p) => p.uptimeSeconds ?? 0)) : null,
    tokens: tokensByModel,
  };
}

export async function sampleEngines() {
  const cfg = getConfig();
  const enabledEngines = Object.keys(cfg).filter((k) => cfg[k]?.enabled === true);
  const results = await Promise.all(enabledEngines.map(fetchEngine));
  return results;
}

export function getEngineCommands() {
  return ENGINE_COMMANDS;
}