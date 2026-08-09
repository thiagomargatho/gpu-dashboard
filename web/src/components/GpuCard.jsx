import { Bar, Card, Chip, Metric } from './ui.jsx';
import { Spark, useTrail } from './Chart.jsx';
import {
  NA, UTIL_TEXT, VRAM_TEXT, levelColor, mib, num, pct,
  tempLevel, utilLevel, vramLevel,
} from '../lib/format.js';

export default function GpuCard({ gpu, thresholds }) {
  // Todos os hooks antes de qualquer return: uma placa que cai do barramento
  // muda de ramo em pleno voo, e ordem de hook variavel derruba o React.
  const trail = useTrail(gpu.status === 'ok' ? gpu.utilGpu : null);

  if (gpu.status !== 'ok') return <OfflineGpu gpu={gpu} />;

  const util = utilLevel(gpu.utilGpu);
  const vram = vramLevel(gpu.memPercent, thresholds?.gpuVramPercent ?? 95);
  const temp = tempLevel(gpu.tempC, thresholds?.gpuTempC ?? 80);

  return (
    <Card
      title={`${gpu.name ?? 'GPU'} — GPU ${gpu.index}`}
      subtitle={`${gpu.busId ?? NA} · ${gpu.pstate ?? NA}`}
      right={<Chip level={util === 'idle' ? 'info' : util}>{UTIL_TEXT[util]}</Chip>}
    >
      <div className="stat-row">
        <Metric label="GPU" value={pct(gpu.utilGpu)} color={levelColor(util)} />
        <Metric
          label="VRAM"
          value={gpu.memUsedMiB == null ? NA : `${mib(gpu.memUsedMiB)}`}
          unit={gpu.memTotalMiB == null ? '' : `/ ${mib(gpu.memTotalMiB, 0)} GB`}
          color={levelColor(vram)}
        />
        <Metric label="Temp" value={num(gpu.tempC, 0, '°C')} color={levelColor(temp)} />
        <Metric label="Fan" value={pct(gpu.fanPercent)} />
        <Metric
          label="Power"
          value={num(gpu.powerDrawW, 0, ' W')}
          unit={gpu.powerLimitW == null ? '' : `/ ${gpu.powerLimitW.toFixed(0)} W`}
        />
      </div>

      <Bar percent={gpu.memPercent} level={vram} />
      <div className="metric-hint">
        VRAM {pct(gpu.memPercent, 1)} · {VRAM_TEXT[vram]} · clock {num(gpu.clockGraphicsMHz, 0, ' MHz')} /
        {' '}mem {num(gpu.clockMemMHz, 0, ' MHz')}
      </div>

      <Spark points={trail} color={levelColor(util)} domainMax={100} />
    </Card>
  );
}

export function OfflineGpu({ gpu }) {
  return (
    <Card
      className="offline-card"
      title={`${gpu.name ?? 'GPU'} — GPU ${gpu.index}`}
      subtitle={gpu.busId ?? NA}
      right={<Chip level="bad">Fora do barramento</Chip>}
    >
      <div className="offline-body">
        <div style={{ fontSize: 15, color: 'var(--text)', marginBottom: 6 }}>
          A placa não responde ao driver
        </div>
        <div>
          {gpu.error ? `Erro reportado: ${gpu.error}.` : 'Sem detalhe do driver.'}
          {' '}Nenhuma métrica desta GPU está disponível — os campos ficam em {NA} em vez de zero.
        </div>
        <div style={{ marginTop: 10, fontSize: 12 }}>
          O kernel ainda enxerga o dispositivo no barramento PCI, então ela aparece aqui.
          Recuperar exige reiniciar o servidor.
        </div>
      </div>
    </Card>
  );
}
