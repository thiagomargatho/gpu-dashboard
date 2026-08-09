import { getConfig } from './config.js';
import { log, logTransition } from './logger.js';
import { queryGpus, queryProcesses, queryVersions } from './nvidia.js';
import { sampleSystem } from './system.js';
import { sampleOllama } from './ollama.js';
import { evaluate } from './alerts.js';

const MiB = 1024 * 1024;

/** Buffer circular de tamanho fixo — nao cresce, nao precisa de shift(). */
class Ring {
  constructor(capacity) {
    this.capacity = capacity;
    this.items = new Array(capacity);
    this.size = 0;
    this.head = 0;
  }

  push(item) {
    this.items[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) this.size += 1;
  }

  /** Do mais antigo ao mais recente, opcionalmente so o que for depois de `since`. */
  toArray(since = 0) {
    const out = [];
    const start = (this.head - this.size + this.capacity) % this.capacity;
    for (let i = 0; i < this.size; i += 1) {
      const item = this.items[(start + i) % this.capacity];
      if (item && item.t >= since) out.push(item);
    }
    return out;
  }
}

const state = {
  snapshot: null,
  history: new Map(), // indice da GPU -> Ring
  energy: { wh: 0, startedAt: Date.now(), samples: 0, sumW: 0, lastAt: null },
  listeners: new Set(),
  startedAt: Date.now(),
  timer: null,
};

function ringFor(index) {
  if (!state.history.has(index)) {
    const cfg = getConfig().collect;
    const capacity = Math.ceil((cfg.historyMinutes * 60 * 1000) / cfg.intervalMs) + 10;
    state.history.set(index, new Ring(capacity));
  }
  return state.history.get(index);
}

/** Um processo e "do Ollama" se o binario for o servidor ou o runner. */
function isOllamaProcess(proc) {
  const name = `${proc.processName || ''} ${proc.command || ''}`;
  return /ollama|llama-server|llama_server/i.test(name);
}

/**
 * Cruza os processos do nvidia-smi com o /api/ps do Ollama.
 *
 * O /api/ps NAO informa em qual GPU o modelo esta — entao a associacao
 * modelo -> placa e inferida por proximidade entre `size_vram` e a memoria que
 * o processo ocupa na placa. Quando nao da para casar 1:1, o campo sai como
 * null e a UI diz que nao foi possivel determinar, em vez de chutar.
 */
function correlate(gpus, procs, ollama) {
  const byUuid = new Map();
  for (const gpu of gpus) {
    if (gpu.status !== 'ok') continue;
    byUuid.set(gpu.uuid, gpu);
  }

  const perGpu = new Map();
  for (const gpu of gpus) {
    perGpu.set(gpu.index, { ollamaBytes: 0, otherBytes: 0, procs: [] });
  }

  for (const proc of procs) {
    const gpu = byUuid.get(proc.gpuUuid);
    if (!gpu) continue;
    const bucket = perGpu.get(gpu.index);
    const bytes = (proc.memMiB ?? 0) * MiB;
    if (isOllamaProcess(proc)) bucket.ollamaBytes += bytes;
    else bucket.otherBytes += bytes;
    bucket.procs.push({ ...proc, gpuIndex: gpu.index, isOllama: isOllamaProcess(proc) });
  }

  // Modelo -> GPU. O /api/ps nao diz a placa, entao inferimos pelo tamanho.
  //
  // A janela e assimetrica de proposito: o `size_vram` do Ollama conta os pesos
  // do modelo, enquanto o processo aloca tambem o contexto CUDA e os buffers de
  // calculo. A alocacao real e sempre MAIOR que o size_vram — medido aqui:
  // gestao360 declara 5.73 GB e o llama-server ocupa 6.94 GB (+21%).
  // Aceitamos de 0.95x a 1.6x, e so quando o candidato e unico.
  const onGpu = procs
    .filter((p) => isOllamaProcess(p) && byUuid.has(p.gpuUuid))
    .map((p) => ({ p, gpu: byUuid.get(p.gpuUuid) }));
  const inVram = ollama.loaded.filter((m) => m.vramBytes > 0);
  const claimed = new Set();

  const placement = ollama.loaded.map((model) => {
    if (!model.vramBytes) return { model: model.name, gpuIndex: null, confidence: 'cpu' };

    // Um unico modelo na VRAM e um unico processo de GPU: nao ha ambiguidade
    // possivel, independente do tamanho.
    if (inVram.length === 1 && onGpu.length === 1) {
      return { model: model.name, gpuIndex: onGpu[0].gpu.index, confidence: 'estimado' };
    }

    const candidates = onGpu
      .filter((c) => !claimed.has(c.p.pid))
      .filter((c) => {
        const bytes = (c.p.memMiB ?? 0) * MiB;
        return bytes >= model.vramBytes * 0.95 && bytes <= model.vramBytes * 1.6;
      });
    if (candidates.length !== 1) return { model: model.name, gpuIndex: null, confidence: 'indeterminado' };
    claimed.add(candidates[0].p.pid);
    return { model: model.name, gpuIndex: candidates[0].gpu.index, confidence: 'estimado' };
  });

  const usage = gpus.map((gpu) => {
    const bucket = perGpu.get(gpu.index) ?? { ollamaBytes: 0, otherBytes: 0 };
    const totalUsed = gpu.memUsedMiB != null ? gpu.memUsedMiB * MiB : null;
    const accounted = bucket.ollamaBytes + bucket.otherBytes;
    return {
      index: gpu.index,
      status: gpu.status,
      totalBytes: gpu.memTotalMiB != null ? gpu.memTotalMiB * MiB : null,
      usedBytes: totalUsed,
      ollamaBytes: gpu.status === 'ok' ? bucket.ollamaBytes : null,
      otherBytes: gpu.status === 'ok' ? bucket.otherBytes : null,
      // A diferenca entre memory.used e a soma dos processos e overhead de
      // driver/contexto CUDA. Sai separado para nao ser confundido com processo.
      overheadBytes: gpu.status === 'ok' && totalUsed != null
        ? Math.max(0, totalUsed - accounted) : null,
    };
  });

  const gpuProcs = [...perGpu.values()].flatMap((b) => b.procs);
  return { usage, placement, gpuProcesses: gpuProcs };
}

function accumulateEnergy(gpus) {
  const now = Date.now();
  const totalW = gpus.reduce((a, g) => a + (g.powerDrawW ?? 0), 0);
  const anyReading = gpus.some((g) => g.powerDrawW != null);
  if (!anyReading) return;

  if (state.energy.lastAt) {
    const hours = (now - state.energy.lastAt) / 3_600_000;
    state.energy.wh += totalW * hours;
  }
  state.energy.lastAt = now;
  state.energy.samples += 1;
  state.energy.sumW += totalW;
}

function energyReport(gpus) {
  const cfg = getConfig().energy;
  const totalW = gpus.reduce((a, g) => a + (g.powerDrawW ?? 0), 0);
  const avgW = state.energy.samples ? state.energy.sumW / state.energy.samples : null;
  const elapsedHours = (Date.now() - state.energy.startedAt) / 3_600_000;
  const dailyKwh = avgW != null ? (avgW * 24) / 1000 : null;
  const monthlyKwh = dailyKwh != null ? dailyKwh * 30 : null;

  return {
    perGpu: gpus.map((g) => ({ index: g.index, watts: g.powerDrawW, limit: g.powerLimitW })),
    totalWatts: gpus.some((g) => g.powerDrawW != null) ? +totalW.toFixed(1) : null,
    averageWatts: avgW != null ? +avgW.toFixed(1) : null,
    accumulatedWh: +state.energy.wh.toFixed(3),
    measuredHours: +elapsedHours.toFixed(3),
    dailyKwh: dailyKwh != null ? +dailyKwh.toFixed(2) : null,
    monthlyKwh: monthlyKwh != null ? +monthlyKwh.toFixed(1) : null,
    pricePerKwh: cfg.pricePerKwh,
    currency: cfg.currency,
    dailyCost: dailyKwh != null ? +(dailyKwh * cfg.pricePerKwh).toFixed(2) : null,
    monthlyCost: monthlyKwh != null ? +(monthlyKwh * cfg.pricePerKwh).toFixed(2) : null,
    accumulatedCost: +((state.energy.wh / 1000) * cfg.pricePerKwh).toFixed(4),
    disclaimer: 'Estimativa baseada somente no consumo reportado pelas GPUs via nvidia-smi. '
      + 'Não inclui CPU, placa-mãe, discos, ventoinhas nem perdas da fonte — '
      + 'não representa o consumo total do servidor.',
  };
}

async function collect() {
  const t = Date.now();
  try {
    const [{ gpus, smiError }, procs, system, ollama, versions] = await Promise.all([
      queryGpus(), queryProcesses(), sampleSystem(), sampleOllama(), queryVersions(),
    ]);

    if (smiError) {
      logTransition('smi', 'fail', 'error', `falha no nvidia-smi: ${smiError}`);
    } else {
      logTransition('smi', 'ok', 'info', 'nvidia-smi voltou a responder');
    }

    logTransition('ollama', ollama.online ? 'up' : 'down',
      ollama.online ? 'info' : 'warn',
      ollama.online ? `Ollama online (v${ollama.version})` : `Ollama offline em ${ollama.url}`);

    for (const gpu of gpus) {
      logTransition(`gpu${gpu.index}-state`, gpu.status,
        gpu.status === 'ok' ? 'info' : 'error',
        gpu.status === 'ok'
          ? `GPU ${gpu.index} respondendo normalmente`
          : `GPU ${gpu.index} (${gpu.busId}) fora do barramento: ${gpu.error}`);

      const hot = gpu.tempC != null && gpu.tempC >= getConfig().alerts.gpuTempC;
      logTransition(`gpu${gpu.index}-temp`, hot ? 'hot' : 'ok',
        hot ? 'warn' : 'info',
        hot ? `GPU ${gpu.index} a ${gpu.tempC}°C` : `GPU ${gpu.index} voltou a temperatura normal`);

      if (gpu.status !== 'ok') continue;
      ringFor(gpu.index).push({
        t,
        util: gpu.utilGpu,
        mem: gpu.memUsedMiB,
        memPct: gpu.memPercent,
        temp: gpu.tempC,
        power: gpu.powerDrawW,
        fan: gpu.fanPercent,
      });
    }

    accumulateEnergy(gpus);
    const { usage, placement, gpuProcesses } = correlate(gpus, procs, ollama);

    const snapshot = {
      t,
      collectorUptimeSeconds: Math.round((Date.now() - state.startedAt) / 1000),
      nvidia: { ...versions, smiError },
      gpus,
      gpuProcesses,
      vramUsage: usage,
      modelPlacement: placement,
      energy: energyReport(gpus),
      system,
      ollama,
      // A UI pinta os estados com os MESMOS limiares que geram os alertas —
      // sem isso, mudar o limite nas Configuracoes so mudaria metade da tela.
      alertThresholds: getConfig().alerts,
      alerts: [],
    };
    snapshot.alerts = evaluate(snapshot);
    state.snapshot = snapshot;
    broadcast(snapshot);
  } catch (err) {
    logTransition('collect', 'fail', 'error', `falha na coleta: ${err.message}`);
  }
}

function broadcast(snapshot) {
  const payload = `data: ${JSON.stringify(snapshot)}\n\n`;
  for (const res of state.listeners) {
    try {
      res.write(payload);
    } catch {
      state.listeners.delete(res);
    }
  }
}

export function subscribe(res) {
  state.listeners.add(res);
  if (state.snapshot) res.write(`data: ${JSON.stringify(state.snapshot)}\n\n`);
  return () => state.listeners.delete(res);
}

export function currentSnapshot() {
  return state.snapshot;
}

export function listenerCount() {
  return state.listeners.size;
}

/**
 * Historico reamostrado para no maximo `maxPoints` — 30 min a cada 2s sao 900
 * amostras, e mandar isso a cada troca de aba nao ajuda ninguem a ler o grafico.
 */
export function history(minutes, maxPoints = 240) {
  const since = Date.now() - minutes * 60 * 1000;
  const out = {};
  for (const [index, ring] of state.history) {
    const rows = ring.toArray(since);
    if (rows.length <= maxPoints) {
      out[index] = rows;
      continue;
    }
    const step = rows.length / maxPoints;
    const sampled = [];
    for (let i = 0; i < maxPoints; i += 1) {
      const from = Math.floor(i * step);
      const to = Math.max(from + 1, Math.floor((i + 1) * step));
      const slice = rows.slice(from, to);
      const avg = (key) => {
        const vals = slice.map((r) => r[key]).filter((v) => v != null);
        return vals.length ? +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : null;
      };
      sampled.push({
        t: slice[slice.length - 1].t,
        util: avg('util'),
        mem: avg('mem'),
        memPct: avg('memPct'),
        temp: avg('temp'),
        // Pico importa mais que media em potencia: e o pico que derruba a fonte.
        power: slice.map((r) => r.power).filter((v) => v != null).length
          ? Math.max(...slice.map((r) => r.power).filter((v) => v != null)) : null,
        fan: avg('fan'),
      });
    }
    out[index] = sampled;
  }
  return out;
}

export function start() {
  const { intervalMs } = getConfig().collect;
  log('info', `coletor iniciado — intervalo de ${intervalMs}ms, `
    + `historico de ${getConfig().collect.historyMinutes} min`);
  collect();
  state.timer = setInterval(collect, intervalMs);
  state.timer.unref?.();
}

export function stop() {
  if (state.timer) clearInterval(state.timer);
  for (const res of state.listeners) {
    try { res.end(); } catch { /* cliente ja foi embora */ }
  }
  state.listeners.clear();
}
