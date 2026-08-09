import { Alerts, Bar, Card, Chip, Empty, Legend, Metric, StackBar } from '../components/ui.jsx';
import GpuCard from '../components/GpuCard.jsx';
import {
  NA, bytes, bytesNum, duration, expiry, levelColor, mib, money, num, pct, vramLevel,
} from '../lib/format.js';

export default function Dashboard({ snapshot, thresholds }) {
  const { system: sys, gpus, ollama, energy, vramUsage, modelPlacement, alerts } = snapshot;

  return (
    <>
      {alerts.length > 0 && (
        <>
          <div className="section-title">Alertas</div>
          <Alerts alerts={alerts} />
        </>
      )}

      <div className="section-title">Servidor</div>
      <div className="grid grid-4">
        <Card>
          <Metric
            label="CPU"
            value={pct(sys.cpu.percent)}
            hint={`${sys.cpu.cores ?? NA} núcleos / ${sys.cpu.threads ?? NA} threads`}
          />
          <Bar percent={sys.cpu.percent} level={sys.cpu.percent >= 90 ? 'warn' : 'ok'} />
        </Card>

        <Card>
          <Metric
            label="RAM"
            value={`${bytesNum(sys.memory?.usedBytes)} / ${bytesNum(sys.memory?.totalBytes)}`}
            unit="GB"
            hint={`${pct(sys.memory?.percent)} · ${bytes(sys.memory?.availableBytes)} disponível`}
          />
          <Bar
            percent={sys.memory?.percent}
            level={sys.memory?.percent >= (thresholds?.ramPercent ?? 90) ? 'bad' : 'ok'}
          />
        </Card>

        <Card>
          <Metric
            label="Disco"
            value={`${bytesNum(sys.disk?.usedBytes, { digits: 0 })} / ${bytesNum(sys.disk?.totalBytes, { digits: 0 })}`}
            unit="GB"
            hint={`${pct(sys.disk?.percent)} · ${bytes(sys.disk?.freeBytes)} livre`}
          />
          <Bar
            percent={sys.disk?.percent}
            level={sys.disk?.freePercent <= (thresholds?.diskFreePercent ?? 10) ? 'bad' : 'ok'}
          />
        </Card>

        <Card>
          <Metric
            label="Sistema"
            value={num(sys.temperature?.celsius, 0, '°C')}
            size="sm"
            hint={sys.temperature ? `sensor ${sys.temperature.source}` : 'sem sensor de CPU disponível'}
          />
          <div className="metric-hint" style={{ marginTop: 10, lineHeight: 1.9 }}>
            Uptime <strong>{duration(sys.uptimeSeconds)}</strong><br />
            Load <strong>{sys.load.one} · {sys.load.five} · {sys.load.fifteen}</strong><br />
            <span className="mono">{sys.hostname} · {sys.network.primary ?? NA}</span>
          </div>
        </Card>
      </div>

      <div className="section-title">GPUs</div>
      <div className="grid grid-gpu">
        {gpus.map((gpu) => <GpuCard key={gpu.index} gpu={gpu} thresholds={thresholds} />)}
      </div>

      <div className="section-title">Ollama e energia</div>
      <div className="grid grid-2">
        <OllamaCard ollama={ollama} placement={modelPlacement} />
        <EnergyCard energy={energy} gpus={gpus} />
      </div>

      <div className="section-title">VRAM por GPU</div>
      <div className="grid grid-2">
        {vramUsage.map((u) => (
          <VramCard key={u.index} usage={u} placement={modelPlacement} />
        ))}
      </div>
    </>
  );
}

function OllamaCard({ ollama, placement }) {
  const loadedInVram = ollama.loaded.filter((m) => m.vramBytes > 0);
  const onCpu = ollama.loaded.filter((m) => !m.vramBytes);

  return (
    <Card
      title="Ollama"
      subtitle={`${ollama.url}${ollama.version ? ` · v${ollama.version}` : ''}`}
      right={<Chip level={ollama.online ? 'ok' : 'bad'}>{ollama.online ? 'Online' : 'Offline'}</Chip>}
    >
      <div className="stat-row" style={{ marginBottom: 4 }}>
        <Metric label="Instalados" value={num(ollama.models.length)} size="sm" />
        <Metric label="Carregados" value={num(ollama.loaded.length)} size="sm" />
        <Metric label="Na VRAM" value={num(loadedInVram.length)} size="sm" />
        <Metric label="CPU" value={pct(ollama.cpuPercent, 1)} size="sm" />
        <Metric label="RSS" value={bytes(ollama.rssBytes)} size="sm" />
      </div>

      {ollama.loaded.length === 0 ? (
        <Empty>Nenhum modelo carregado na memória.</Empty>
      ) : (
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table>
            <thead>
              <tr>
                <th>Modelo carregado</th>
                <th>Onde</th>
                <th className="num">VRAM</th>
                <th className="num">Contexto</th>
                <th className="num">Expira</th>
              </tr>
            </thead>
            <tbody>
              {ollama.loaded.map((m) => {
                const place = placement.find((p) => p.model === m.name);
                return (
                  <tr key={m.name}>
                    <td>{m.name}</td>
                    <td>
                      {m.vramBytes > 0
                        ? <Chip level="info">{place?.gpuIndex != null ? `GPU ${place.gpuIndex}` : 'GPU'}</Chip>
                        : <Chip>CPU</Chip>}
                    </td>
                    <td className="num">{m.vramBytes ? bytes(m.vramBytes) : NA}</td>
                    <td className="num">{num(m.contextLength)}</td>
                    <td className="num">{expiry(m.expiresAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {onCpu.length > 0 && (
        <div className="note" style={{ marginTop: 12 }}>
          {onCpu.length === 1 ? 'O modelo' : 'Os modelos'} <strong>{onCpu.map((m) => m.name).join(', ')}</strong>
          {' '}{onCpu.length === 1 ? 'está' : 'estão'} residente{onCpu.length === 1 ? '' : 's'} em RAM,
          rodando 100% em CPU (<span className="mono">size_vram = 0</span>).
        </div>
      )}
    </Card>
  );
}

function EnergyCard({ energy, gpus }) {
  return (
    <Card title="Energia (GPUs)" subtitle="somente as placas de vídeo">
      <div style={{ display: 'flex', gap: 28, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <Metric label="Total agora" value={num(energy.totalWatts, 0)} unit="W" />
        <div style={{ flex: 1, minWidth: 150 }}>
          {energy.perGpu.map((g) => (
            <div key={g.index} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '3px 0' }}>
              <span style={{ color: 'var(--text-muted)' }}>GPU {g.index}</span>
              <span className={g.watts == null ? 'na' : undefined}>
                {g.watts == null ? NA : `${g.watts.toFixed(0)} W`}
                {g.limit != null && <span style={{ color: 'var(--text-faint)' }}> / {g.limit.toFixed(0)} W</span>}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="stat-row" style={{ marginTop: 18 }}>
        <Metric label="Média medida" value={num(energy.averageWatts, 0, ' W')} size="sm" />
        <Metric label="Acumulado" value={num(energy.accumulatedWh, 1, ' Wh')} size="sm"
          hint={`em ${duration(energy.measuredHours * 3600)}`} />
        <Metric label="Estimativa 24h" value={num(energy.dailyKwh, 2, ' kWh')} size="sm"
          hint={money(energy.dailyCost, energy.currency)} />
        <Metric label="Estimativa 30d" value={num(energy.monthlyKwh, 1, ' kWh')} size="sm"
          hint={money(energy.monthlyCost, energy.currency)} />
      </div>

      <div className="note" style={{ marginTop: 16 }}>
        {energy.disclaimer} Tarifa configurada: {money(energy.pricePerKwh, energy.currency)}/kWh.
        {gpus.some((g) => g.status !== 'ok')
          && ' Uma das placas não responde, então o consumo dela não entra em nenhum destes números.'}
      </div>
    </Card>
  );
}

function VramCard({ usage, placement }) {
  if (usage.status !== 'ok') {
    return (
      <Card className="offline-card" title={`GPU ${usage.index}`}>
        <div className="offline-body">Sem leitura de VRAM: a placa não responde ao driver.</div>
      </Card>
    );
  }

  const free = usage.totalBytes != null && usage.usedBytes != null
    ? usage.totalBytes - usage.usedBytes : null;
  const level = vramLevel(usage.totalBytes ? (usage.usedBytes / usage.totalBytes) * 100 : null);
  const here = placement.filter((p) => p.gpuIndex === usage.index);
  const undetermined = placement.some((p) => p.confidence === 'indeterminado');

  return (
    <Card
      title={`GPU ${usage.index}`}
      subtitle={`${bytesNum(usage.usedBytes)} / ${bytesNum(usage.totalBytes)} GB em uso`}
      right={<Chip level={level}>{pct(usage.totalBytes ? (usage.usedBytes / usage.totalBytes) * 100 : null)}</Chip>}
    >
      <StackBar
        total={usage.totalBytes}
        segments={[
          { label: 'Ollama', value: usage.ollamaBytes ?? 0, color: 'var(--blue)', text: bytes(usage.ollamaBytes) },
          { label: 'Outros processos', value: usage.otherBytes ?? 0, color: 'var(--amber)', text: bytes(usage.otherBytes) },
          { label: 'Overhead do driver', value: usage.overheadBytes ?? 0, color: 'var(--text-faint)', text: bytes(usage.overheadBytes) },
          { label: 'Livre', value: free ?? 0, color: 'var(--track)', text: bytes(free) },
        ]}
      />
      <Legend
        items={[
          { label: 'Ollama', color: 'var(--blue)', text: bytes(usage.ollamaBytes) },
          { label: 'Outros', color: 'var(--amber)', text: bytes(usage.otherBytes) },
          { label: 'Overhead', color: 'var(--text-faint)', text: bytes(usage.overheadBytes) },
          { label: 'Livre', color: 'var(--track)', text: bytes(free) },
        ]}
      />

      <div className="note" style={{ marginTop: 14 }}>
        {here.length > 0 ? (
          <>
            Distribuição estimada: <strong>{here.map((p) => p.model).join(', ')}</strong>.
            {' '}A associação modelo→placa é inferida cruzando <span className="mono">/api/ps</span> com
            a memória por processo do <span className="mono">nvidia-smi</span> — o Ollama não informa a GPU.
          </>
        ) : undetermined ? (
          'Não foi possível determinar a distribuição por modelo nesta placa.'
        ) : (
          'Nenhum modelo do Ollama alocado nesta placa.'
        )}
        {usage.overheadBytes > 0 && (
          <> O overhead de {bytes(usage.overheadBytes)} é contexto CUDA do driver, não um processo.</>
        )}
      </div>
    </Card>
  );
}
