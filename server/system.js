import { execFile } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import { getConfig } from './config.js';

/** CPU% precisa de dois pontos no tempo — guardamos o anterior entre coletas. */
let prevCpu = null;

async function cpuUsage() {
  let line;
  try {
    const stat = await readFile('/proc/stat', 'utf8');
    line = stat.split('\n')[0];
  } catch {
    return null;
  }
  const v = line.trim().split(/\s+/).slice(1).map(Number);
  const idle = (v[3] || 0) + (v[4] || 0);
  const total = v.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);

  const prev = prevCpu;
  prevCpu = { idle, total };
  if (!prev) return null; // primeira coleta nao tem delta: N/A, nao zero

  const dTotal = total - prev.total;
  const dIdle = idle - prev.idle;
  if (dTotal <= 0) return null;
  return +(((dTotal - dIdle) / dTotal) * 100).toFixed(1);
}

async function memory() {
  let info;
  try {
    info = await readFile('/proc/meminfo', 'utf8');
  } catch {
    return null;
  }
  const kv = {};
  for (const line of info.split('\n')) {
    const m = line.match(/^(\w+):\s+(\d+)/);
    if (m) kv[m[1]] = Number(m[2]) * 1024;
  }
  const total = kv.MemTotal ?? null;
  const available = kv.MemAvailable ?? null;
  const swapTotal = kv.SwapTotal ?? null;
  const swapFree = kv.SwapFree ?? null;
  return {
    totalBytes: total,
    availableBytes: available,
    freeBytes: kv.MemFree ?? null,
    usedBytes: total != null && available != null ? total - available : null,
    percent: total && available != null ? +(((total - available) / total) * 100).toFixed(1) : null,
    cachedBytes: (kv.Cached ?? 0) + (kv.Buffers ?? 0),
    swapTotalBytes: swapTotal,
    swapFreeBytes: swapFree,
    swapUsedBytes: swapTotal != null && swapFree != null ? swapTotal - swapFree : null,
    swapPercent: swapTotal ? +(((swapTotal - swapFree) / swapTotal) * 100).toFixed(1) : null,
  };
}

async function disk() {
  const mount = getConfig().disk.mount;
  const out = await new Promise((resolve) => {
    // -P: formato POSIX, uma linha por sistema de arquivos. -B1: bytes.
    execFile('/usr/bin/df', ['-P', '-B1', mount], { timeout: 4000, encoding: 'utf8' },
      (err, stdout) => resolve(err ? null : stdout));
  });
  if (!out) return null;
  const line = out.trim().split('\n').pop();
  const c = line.trim().split(/\s+/);
  if (c.length < 6) return null;
  const total = Number(c[1]);
  const used = Number(c[2]);
  const free = Number(c[3]);
  return {
    filesystem: c[0],
    mount: c[5],
    totalBytes: total,
    usedBytes: used,
    freeBytes: free,
    percent: total ? +((used / total) * 100).toFixed(1) : null,
    freePercent: total ? +((free / total) * 100).toFixed(1) : null,
  };
}

/**
 * lm-sensors nao esta instalado nesta maquina, entao lemos o sysfs direto.
 * Se nenhuma fonte responder, devolve null e a UI mostra N/A.
 */
async function cpuTemp() {
  try {
    const zones = await readdir('/sys/class/thermal');
    for (const zone of zones) {
      if (!zone.startsWith('thermal_zone')) continue;
      const type = (await readFile(`/sys/class/thermal/${zone}/type`, 'utf8')).trim();
      if (!/x86_pkg_temp|cpu|coretemp|k10temp/i.test(type)) continue;
      const milli = Number((await readFile(`/sys/class/thermal/${zone}/temp`, 'utf8')).trim());
      if (Number.isFinite(milli)) return { celsius: +(milli / 1000).toFixed(1), source: type };
    }
  } catch { /* cai para o hwmon */ }

  try {
    const dirs = await readdir('/sys/class/hwmon');
    for (const d of dirs) {
      const base = `/sys/class/hwmon/${d}`;
      const name = (await readFile(`${base}/name`, 'utf8')).trim();
      if (!/coretemp|k10temp|zenpower/i.test(name)) continue;
      const milli = Number((await readFile(`${base}/temp1_input`, 'utf8')).trim());
      if (Number.isFinite(milli)) return { celsius: +(milli / 1000).toFixed(1), source: name };
    }
  } catch { /* nenhuma fonte: N/A */ }

  return null;
}

function cpuTopology() {
  const cpus = os.cpus();
  return {
    model: cpus[0]?.model?.replace(/\s+/g, ' ').trim() ?? null,
    threads: cpus.length,
    cores: physicalCores ?? null,
  };
}

// Nucleos fisicos != threads (i7-6700: 4 nucleos, 8 threads). Lido uma vez.
let physicalCores = null;
async function readPhysicalCores() {
  try {
    const info = await readFile('/proc/cpuinfo', 'utf8');
    const pairs = new Set();
    let physId = null;
    for (const line of info.split('\n')) {
      const p = line.match(/^physical id\s*:\s*(\d+)/);
      if (p) physId = p[1];
      const c = line.match(/^core id\s*:\s*(\d+)/);
      if (c) pairs.add(`${physId}:${c[1]}`);
    }
    physicalCores = pairs.size || null;
  } catch {
    physicalCores = null;
  }
}

function addresses() {
  const list = [];
  for (const [iface, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      list.push({ iface, address: a.address });
    }
  }
  // Prefere a LAN de verdade: docker (172.16/12) e tailscale (100.64/10) ficam depois.
  const isLan = (ip) => /^(192\.168\.|10\.(?!50\.)|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(ip)
    && !/^172\.(1[7-9]|2[0-9])\./.test(ip);
  const primary = list.find((a) => isLan(a.address)) || list[0] || null;
  return { primary: primary?.address ?? null, all: list };
}

export async function sampleSystem() {
  if (physicalCores === null) await readPhysicalCores();
  const [cpuPercent, mem, dsk, temp] = await Promise.all([
    cpuUsage(), memory(), disk(), cpuTemp(),
  ]);
  const [l1, l5, l15] = os.loadavg();
  const net = addresses();

  return {
    hostname: os.hostname(),
    platform: `${os.type()} ${os.release()}`,
    uptimeSeconds: Math.round(os.uptime()),
    cpu: { ...cpuTopology(), percent: cpuPercent },
    load: {
      one: +l1.toFixed(2),
      five: +l5.toFixed(2),
      fifteen: +l15.toFixed(2),
      perCore: cpuTopology().threads ? +(l1 / cpuTopology().threads).toFixed(2) : null,
    },
    memory: mem,
    disk: dsk,
    temperature: temp,
    network: net,
  };
}
