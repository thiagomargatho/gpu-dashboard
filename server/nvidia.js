import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const SMI = '/usr/bin/nvidia-smi';
const TIMEOUT_MS = 4000;

// Todas as chamadas usam execFile com argumentos fixos — nada aqui vem do
// navegador, entao nao existe superficie de injecao de shell.
function run(args) {
  return new Promise((resolve) => {
    execFile(SMI, args, { timeout: TIMEOUT_MS, encoding: 'utf8' }, (err, stdout, stderr) => {
      resolve({ stdout: stdout || '', stderr: stderr || '', error: err || null });
    });
  });
}

const GPU_FIELDS = [
  'index', 'name', 'uuid', 'pci.bus_id',
  'utilization.gpu', 'utilization.memory',
  'memory.used', 'memory.free', 'memory.total',
  'temperature.gpu', 'fan.speed',
  'power.draw', 'power.limit', 'power.max_limit',
  'clocks.gr', 'clocks.mem', 'pstate', 'driver_version',
];

/** "[N/A]", "[Not Supported]", "" -> null. Nunca inventa valor. */
function num(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s || s.startsWith('[') || s === 'N/A') return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

function str(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s || s.startsWith('[') || s === 'N/A') return null;
  return s;
}

/** 00000000:01:00.0 e 01:00.0 viram a mesma chave. */
function shortBus(busId) {
  if (!busId) return null;
  const m = String(busId).trim().match(/([0-9a-f]{2}:[0-9a-f]{2}\.[0-9a-f])$/i);
  return m ? m[1].toLowerCase() : String(busId).trim().toLowerCase();
}

/**
 * Placas que o kernel enxerga no barramento, independente de o driver
 * conseguir falar com elas. E o unico jeito de saber que existe uma GPU 0
 * quando o nvidia-smi ja desistiu dela.
 */
let inventoryCache = null;
export async function pciInventory() {
  if (inventoryCache) return inventoryCache;
  const out = await new Promise((resolve) => {
    execFile('/usr/bin/lspci', ['-D'], { timeout: TIMEOUT_MS, encoding: 'utf8' }, (err, stdout) =>
      resolve(err ? '' : stdout));
  });
  const gpus = [];
  for (const line of out.split('\n')) {
    if (!/nvidia/i.test(line)) continue;
    if (!/VGA compatible controller|3D controller/i.test(line)) continue;
    const bus = line.split(' ')[0];
    const nameMatch = line.match(/\[([^\]]+)\]/g);
    gpus.push({
      bus: shortBus(bus),
      busFull: bus,
      pciName: nameMatch ? nameMatch[nameMatch.length - 1].replace(/[[\]]/g, '') : null,
    });
  }
  inventoryCache = gpus.sort((a, b) => a.bus.localeCompare(b.bus));
  return inventoryCache;
}

/**
 * nvidia-smi SAI COM CODIGO 0 mesmo quando uma placa caiu do barramento:
 * ele apenas omite a linha e escreve o erro no stderr. Sem ler o stderr, a
 * dashboard mostraria "1 GPU" e daria a impressao de que esta tudo certo.
 */
function parseFailures(stderr) {
  const failures = [];
  for (const line of stderr.split('\n')) {
    if (!/Unable to determine the device handle/i.test(line)) continue;
    const bus = line.match(/([0-9a-fA-F]{2}:[0-9a-fA-F]{2}\.[0-9a-fA-F])/);
    const idx = line.match(/GPU\s*(\d+)/i);
    const reason = line.split(':').slice(-1)[0].trim();
    failures.push({
      bus: bus ? bus[1].toLowerCase() : null,
      index: idx ? Number(idx[1]) : null,
      reason: reason || 'erro desconhecido',
    });
  }
  return failures;
}

export async function queryGpus() {
  const { stdout, stderr, error } = await run([
    `--query-gpu=${GPU_FIELDS.join(',')}`,
    '--format=csv,noheader,nounits',
  ]);

  const healthy = new Map();
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    const c = line.split(',').map((s) => s.trim());
    if (c.length < GPU_FIELDS.length) continue;
    const memTotal = num(c[8]);
    const memUsed = num(c[6]);
    const powerDraw = num(c[11]);
    const powerLimit = num(c[12]);
    const bus = shortBus(c[3]);
    healthy.set(bus, {
      status: 'ok',
      index: num(c[0]),
      name: str(c[1]),
      uuid: str(c[2]),
      busId: str(c[3]),
      bus,
      utilGpu: num(c[4]),
      utilMemory: num(c[5]),
      memUsedMiB: memUsed,
      memFreeMiB: num(c[7]),
      memTotalMiB: memTotal,
      memPercent: memTotal ? +((memUsed / memTotal) * 100).toFixed(1) : null,
      tempC: num(c[9]),
      fanPercent: num(c[10]),
      powerDrawW: powerDraw,
      powerLimitW: powerLimit,
      powerMaxLimitW: num(c[13]),
      powerPercent: powerLimit ? +((powerDraw / powerLimit) * 100).toFixed(1) : null,
      clockGraphicsMHz: num(c[14]),
      clockMemMHz: num(c[15]),
      pstate: str(c[16]),
      driverVersion: str(c[17]),
      error: null,
    });
  }

  const failures = parseFailures(stderr);
  const inventory = await pciInventory();

  // A lista final e a do barramento, nao a do nvidia-smi: placa que sumiu
  // aparece explicitamente como offline em vez de desaparecer da tela.
  const gpus = inventory.map((dev, i) => {
    const ok = healthy.get(dev.bus);
    if (ok) return { ...ok, pciName: dev.pciName };
    const fail = failures.find((f) => f.bus === dev.bus);
    return {
      status: 'offline',
      index: fail?.index ?? i,
      name: dev.pciName ? `NVIDIA ${dev.pciName}` : null,
      uuid: null,
      busId: dev.busFull,
      bus: dev.bus,
      pciName: dev.pciName,
      utilGpu: null, utilMemory: null,
      memUsedMiB: null, memFreeMiB: null, memTotalMiB: null, memPercent: null,
      tempC: null, fanPercent: null,
      powerDrawW: null, powerLimitW: null, powerMaxLimitW: null, powerPercent: null,
      clockGraphicsMHz: null, clockMemMHz: null, pstate: null, driverVersion: null,
      error: fail?.reason || 'placa nao respondeu ao driver',
    };
  });

  // Nenhuma placa no lspci (driver ausente, container sem passthrough):
  // devolve o que o nvidia-smi deu, para nao esconder informacao.
  if (!gpus.length && healthy.size) return { gpus: [...healthy.values()], smiError: null };

  return {
    gpus,
    smiError: error && !healthy.size ? error.message.split('\n')[0] : null,
  };
}

export async function queryProcesses() {
  const { stdout } = await run([
    '--query-compute-apps=pid,process_name,used_gpu_memory,gpu_uuid',
    '--format=csv,noheader,nounits',
  ]);

  const procs = [];
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    const c = line.split(',').map((s) => s.trim());
    if (c.length < 4) continue;
    const pid = num(c[0]);
    if (pid == null) continue;
    procs.push({
      pid,
      processName: str(c[1]),
      command: (str(c[1]) || '').split('/').pop(),
      memMiB: num(c[2]),
      gpuUuid: str(c[3]),
      user: await procOwner(pid),
    });
  }
  return procs;
}

let uidNames = null;
async function usernameFor(uid) {
  if (!uidNames) {
    uidNames = new Map();
    try {
      const passwd = await readFile('/etc/passwd', 'utf8');
      for (const line of passwd.split('\n')) {
        const p = line.split(':');
        if (p.length > 2) uidNames.set(Number(p[2]), p[0]);
      }
    } catch { /* sem /etc/passwd legivel: fica no uid numerico */ }
  }
  return uidNames.get(uid) ?? String(uid);
}

async function procOwner(pid) {
  try {
    const status = await readFile(`/proc/${pid}/status`, 'utf8');
    const m = status.match(/^Uid:\s+(\d+)/m);
    return m ? usernameFor(Number(m[1])) : null;
  } catch {
    return null; // processo pode ter morrido entre a coleta e a leitura
  }
}

/** Cabecalho do nvidia-smi -q: driver e CUDA. Muda so em upgrade, entao fica em cache. */
let versionCache = { value: { driverVersion: null, cudaVersion: null }, at: 0 };
export async function queryVersions() {
  if (Date.now() - versionCache.at < 5 * 60 * 1000) return versionCache.value;
  const { stdout } = await run(['-q']);
  const head = stdout.split('\n').slice(0, 12).join('\n');
  const driver = head.match(/Driver Version\s*:\s*([\d.]+)/);
  const kmd = head.match(/KMD Version\s*:\s*([\d.]+)/);
  const cudaUmd = head.match(/CUDA UMD Version\s*:\s*([\d.]+)/);
  const cuda = head.match(/CUDA Version\s*:\s*([\d.]+)/);
  versionCache = {
    at: Date.now(),
    value: {
      driverVersion: (kmd || driver) ? (kmd?.[1] || driver[1]) : null,
      cudaVersion: (cudaUmd || cuda) ? (cudaUmd?.[1] || cuda[1]) : null,
    },
  };
  return versionCache.value;
}
