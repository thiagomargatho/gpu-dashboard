import { useState } from 'react';
import Chart from '../components/Chart.jsx';
import { OfflineGpu } from '../components/GpuCard.jsx';
import { Card, Chip, Empty, KeyValues } from '../components/ui.jsx';
import { useHistory } from '../lib/useStream.js';
import {
  NA, UTIL_TEXT, levelColor, mib, num, pct, tempLevel, utilLevel, vramLevel,
} from '../lib/format.js';

const RANGES = [
  ['5m', '5 min'],
  ['15m', '15 min'],
  ['30m', '30 min'],
  ['60m', '1 hora'],
];

export default function Gpus({ snapshot, thresholds }) {
  const [range, setRange] = useState('15m');
  const { series } = useHistory(range);
  const { gpus, gpuProcesses, nvidia } = snapshot;

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div className="section-title" style={{ margin: 0 }}>Histórico por GPU</div>
        <div className="range-tabs">
          {RANGES.map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={range === key}
              onClick={() => setRange(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ height: 12 }} />

      {gpus.map((gpu) => (
        <div key={gpu.index} style={{ marginBottom: 20 }}>
          {gpu.status === 'ok'
            ? <GpuDetail gpu={gpu} points={series[gpu.index] ?? []} nvidia={nvidia} thresholds={thresholds} />
            : <OfflineGpu gpu={gpu} />}
        </div>
      ))}

      <div className="section-title">Processos GPU</div>
      <Card className="card-pad-0">
        {gpuProcesses.length === 0 ? (
          <Empty>Nenhum processo usando as GPUs no momento.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="num">PID</th>
                  <th>Processo</th>
                  <th>GPU</th>
                  <th className="num">VRAM</th>
                  <th>Usuário</th>
                  <th>Caminho</th>
                </tr>
              </thead>
              <tbody>
                {gpuProcesses.map((p) => (
                  <tr key={`${p.pid}-${p.gpuIndex}`}>
                    <td className="num mono">{p.pid}</td>
                    <td>
                      {p.command ?? NA}{' '}
                      {p.isOllama && <Chip level="info">ollama</Chip>}
                    </td>
                    <td>GPU {p.gpuIndex}</td>
                    <td className="num">{p.memMiB == null ? NA : `${mib(p.memMiB)} GB`}</td>
                    <td>{p.user ?? NA}</td>
                    <td className="mono" style={{ color: 'var(--text-faint)' }}>{p.processName ?? NA}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function GpuDetail({ gpu, points, nvidia, thresholds }) {
  const util = utilLevel(gpu.utilGpu);
  const vram = vramLevel(gpu.memPercent, thresholds?.gpuVramPercent ?? 95);
  const temp = tempLevel(gpu.tempC, thresholds?.gpuTempC ?? 80);

  const at = (key) => points.map((p) => ({ t: p.t, v: p[key] }));

  return (
    <Card
      title={`${gpu.name ?? 'GPU'} — GPU ${gpu.index}`}
      subtitle={gpu.uuid ?? NA}
      right={<Chip level={util === 'idle' ? 'info' : util}>{UTIL_TEXT[util]}</Chip>}
    >
      <div className="grid" style={{ gridTemplateColumns: 'minmax(260px, 320px) 1fr', gap: 24 }}>
        <KeyValues
          rows={[
            ['Índice', String(gpu.index)],
            ['Bus PCI', gpu.busId ?? NA],
            ['UUID', <span key="u" className="mono">{gpu.uuid ?? NA}</span>],
            ['Utilização', pct(gpu.utilGpu)],
            ['Utilização de memória', pct(gpu.utilMemory)],
            ['VRAM usada', gpu.memUsedMiB == null ? NA : `${mib(gpu.memUsedMiB)} GB`],
            ['VRAM livre', gpu.memFreeMiB == null ? NA : `${mib(gpu.memFreeMiB)} GB`],
            ['VRAM total', gpu.memTotalMiB == null ? NA : `${mib(gpu.memTotalMiB, 0)} GB`],
            ['VRAM %', pct(gpu.memPercent, 1)],
            ['Temperatura', num(gpu.tempC, 0, ' °C')],
            ['Ventoinha', pct(gpu.fanPercent)],
            ['Power draw', num(gpu.powerDrawW, 1, ' W')],
            ['Power limit', num(gpu.powerLimitW, 0, ' W')],
            ['Teto máximo', num(gpu.powerMaxLimitW, 0, ' W')],
            ['% do limite', pct(gpu.powerPercent, 1)],
            ['Clock gráfico', num(gpu.clockGraphicsMHz, 0, ' MHz')],
            ['Clock de memória', num(gpu.clockMemMHz, 0, ' MHz')],
            ['P-state', gpu.pstate ?? NA],
            ['Driver', gpu.driverVersion ?? nvidia.driverVersion ?? NA],
            ['CUDA', nvidia.cudaVersion ?? NA],
          ]}
        />

        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 18 }}>
          <Chart id={`u${gpu.index}`} title="Utilização da GPU" points={at('util')} unit="%" domainMax={100} color={levelColor(util)} />
          <Chart id={`m${gpu.index}`} title="VRAM utilizada" points={at('memPct')} unit="%" domainMax={100} color={levelColor(vram)} />
          <Chart id={`t${gpu.index}`} title="Temperatura" points={at('temp')} unit="°C" color={levelColor(temp)} />
          <Chart id={`p${gpu.index}`} title="Power draw (pico)" points={at('power')} unit=" W" domainMax={gpu.powerLimitW ?? null} color="var(--blue)" />
          <Chart id={`f${gpu.index}`} title="Ventoinha" points={at('fan')} unit="%" domainMax={100} color="var(--text-muted)" />
        </div>
      </div>
    </Card>
  );
}
