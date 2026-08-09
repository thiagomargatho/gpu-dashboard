import { getConfig } from './config.js';

// Quanto tempo cada GPU esta continuamente acima do limite de utilizacao.
const sustainedSince = new Map();
// Throttling tracking
const throttlingSince = new Map();

function pct(v) {
  return v == null ? '—' : `${v.toFixed(0)}%`;
}

export function evaluate(snapshot) {
  const cfg = getConfig().alerts;
  const out = [];
  const now = Date.now();

  for (const gpu of snapshot.gpus) {
    const label = `GPU ${gpu.index}`;

    if (gpu.status === 'offline') {
      out.push({
        id: `gpu${gpu.index}-offline`,
        level: 'critical',
        scope: label,
        message: `${label} não responde ao driver (${gpu.error}). Recuperação exige reiniciar o servidor.`,
      });
      sustainedSince.delete(gpu.index);
      throttlingSince.delete(gpu.index);
      continue;
    }

    if (gpu.tempC != null && gpu.tempC >= cfg.gpuTempC) {
      out.push({
        id: `gpu${gpu.index}-temp`,
        level: gpu.tempC >= cfg.gpuTempC + 8 ? 'critical' : 'warning',
        scope: label,
        message: `${label} a ${gpu.tempC}°C (limite ${cfg.gpuTempC}°C)`,
      });
    }

    if (gpu.memPercent != null && gpu.memPercent >= cfg.gpuVramPercent) {
      out.push({
        id: `gpu${gpu.index}-vram`,
        level: 'critical',
        scope: label,
        message: `${label} com VRAM em ${pct(gpu.memPercent)} (limite ${cfg.gpuVramPercent}%)`,
      });
    }

    if (gpu.powerPercent != null && gpu.powerPercent >= cfg.gpuPowerPercent) {
      out.push({
        id: `gpu${gpu.index}-power`,
        level: 'warning',
        scope: label,
        message: `${label} puxando ${gpu.powerDrawW}W de ${gpu.powerLimitW}W (${pct(gpu.powerPercent)} do teto)`,
      });
    }

    // Throttling detection: clock below 85% of max for sustained period
    if (gpu.isThrottling) {
      if (!throttlingSince.has(gpu.index)) throttlingSince.set(gpu.index, now);
      const elapsed = (now - throttlingSince.get(gpu.index)) / 1000;
      if (elapsed >= 60) { // Alert after 1 minute of sustained throttling
        out.push({
          id: `gpu${gpu.index}-throttling`,
          level: 'warning',
          scope: label,
          message: `${label} com thermal throttling: clock gráfico em ${gpu.clockRatioGraphicsPercent}% do máximo (${gpu.clockGraphicsMHz}/${gpu.baseClockGraphicsMHz} MHz) há ${Math.round(elapsed / 60)} min`,
        });
      }
    } else {
      throttlingSince.delete(gpu.index);
    }

    // "Carga alta por periodo prolongado" so vale se for continua — um pico de
    // 2 segundos em 100% e o comportamento normal de uma inferencia.
    if (gpu.utilGpu != null && gpu.utilGpu >= cfg.gpuUtilPercent) {
      if (!sustainedSince.has(gpu.index)) sustainedSince.set(gpu.index, now);
      const elapsed = (now - sustainedSince.get(gpu.index)) / 1000;
      if (elapsed >= cfg.gpuUtilSustainedSeconds) {
        out.push({
          id: `gpu${gpu.index}-util`,
          level: 'warning',
          scope: label,
          message: `${label} acima de ${cfg.gpuUtilPercent}% há ${Math.round(elapsed / 60)} min`,
        });
      }
    } else {
      sustainedSince.delete(gpu.index);
    }
  }

  // Alertas de engines offline
  for (const engine of snapshot.engines || []) {
    if (engine.enabled && !engine.online) {
      out.push({
        id: `${engine.engine}-offline`,
        level: 'critical',
        scope: engine.engine,
        message: `${engine.engine} offline em ${engine.url}${engine.error ? ` — ${engine.error}` : ''}`,
      });
    }
  }

  const mem = snapshot.system.memory;
  if (mem?.percent != null && mem.percent >= cfg.ramPercent) {
    out.push({
      id: 'ram',
      level: 'warning',
      scope: 'Sistema',
      message: `RAM em ${pct(mem.percent)} (limite ${cfg.ramPercent}%)`,
    });
  }

  const disk = snapshot.system.disk;
  if (disk?.freePercent != null && disk.freePercent <= cfg.diskFreePercent) {
    out.push({
      id: 'disk',
      level: 'critical',
      scope: 'Sistema',
      message: `Disco com apenas ${pct(disk.freePercent)} livre (limite ${cfg.diskFreePercent}%)`,
    });
  }

  return out;
}
