import { Alerts, Bar, Card, Chip, Empty, Legend, Metric, StackBar } from '../components/ui.jsx';
import GpuCard from '../components/GpuCard.jsx';
import {
  NA, bytes, bytesNum, duration, levelColor, mib, money, num, pct, vramLevel,
} from '../lib/format.js';

function costPerToken(energyWh, tokens, pricePerKwh, currency) {
  if (!tokens || tokens === 0 || !energyWh || !pricePerKwh) return null;
  const costWh = (energyWh / 1000) * pricePerKwh;
  const perToken = costWh / tokens;
  return { perToken, per1k: perToken * 1000, currency };
}

export default function Dashboard({ snapshot, thresholds }) {
  const { system: sys, gpus, engines, energy, vramUsage, modelPlacement, alerts } = snapshot;

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

      <div className="section-title">Motores de Inferência, Energia e Custo/Token</div>
      <div className="grid grid-3">
        <EnginesCard engines={engines} placement={modelPlacement} />
        <EnergyCard energy={energy} gpus={gpus} />
        <CostPerTokenCard engines={engines} energy={energy} />
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

function EnginesCard({ engines, placement }) {
  const enabled = engines?.filter(e => e.enabled) ?? [];
  const online = enabled.filter(e => e.online);
  const totalLoaded = enabled.reduce((a, e) => a + (e.loaded?.length ?? 0), 0);
  const totalModels = enabled.reduce((a, e) => a + (e.models?.length ?? 0), 0);

  return (
    <Card title="Motores de Inferência" subtitle={`${online.length}/${enabled.length} online`}>
      {enabled.length === 0 ? (
        <Empty>Nenhum motor habilitado no config.json</Empty>
      ) : (
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table>
            <thead>
              <tr>
                <th>Motor</th>
                <th className="num">Status</th>
                <th className="num">Versão</th>
                <th className="num">Modelos</th>
                <th className="num">Carregados</th>
                <th className="num">Processos</th>
                <th className="num">CPU%</th>
                <th className="num">RAM</th>
              </tr>
            </thead>
            <tbody>
              {enabled.map((e) => (
                <tr key={e.engine}>
                  <td>{e.engine.toUpperCase()}</td>
                  <td>
                    <Chip level={e.online ? 'ok' : 'bad'}>{e.online ? 'Online' : 'Offline'}</Chip>
                  </td>
                  <td className="num">{e.version ?? NA}</td>
                  <td className="num">{e.models?.length ?? 0}</td>
                  <td className="num">{e.loaded?.length ?? 0}</td>
                  <td className="num">{e.processes?.length ?? 0}</td>
                  <td className="num">{e.cpuPercent != null ? pct(e.cpuPercent) : NA}</td>
                  <td className="num">{e.rssBytes != null ? bytes(e.rssBytes) : NA}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {enabled.length > 0 && (
        <div className="note" style={{ marginTop: 12 }}>
          Total: <strong>{totalModels}</strong> modelos instalados, <strong>{totalLoaded}</strong> carregados.
          {enabled.some(e => e.error) && ' Alguns motores têm erros — veja a aba Motores.'}
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

function CostPerTokenCard({ engines, energy }) {
  const enabled = engines?.filter(e => e.enabled && e.online) ?? [];
  const totalWh = energy?.accumulatedWh ?? 0;
  const pricePerKwh = energy?.pricePerKwh ?? 0.95;
  const currency = energy?.currency ?? 'R$';

  // Aggregate tokens across all engines
  const tokensByModel = {};
  let totalTokens = 0;
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;

  for (const engine of enabled) {
    if (engine.tokens) {
      for (const [model, counts] of Object.entries(engine.tokens)) {
        if (!tokensByModel[model]) {
          tokensByModel[model] = { promptTokens: 0, completionTokens: 0, totalTokens: 0, engine: engine.engine };
        }
        tokensByModel[model].promptTokens += counts.promptTokens || 0;
        tokensByModel[model].completionTokens += counts.completionTokens || 0;
        tokensByModel[model].totalTokens += counts.totalTokens || 0;
        totalPromptTokens += counts.promptTokens || 0;
        totalCompletionTokens += counts.completionTokens || 0;
        totalTokens += counts.totalTokens || 0;
      }
    }
  }

  const cost = costPerToken(totalWh, totalTokens, pricePerKwh, currency);

  if (!enabled.length) {
    return (
      <Card title="Custo por Token" subtitle="nenhum motor online">
        <Empty>Habilite motores no config.json</Empty>
      </Card>
    );
  }

  if (totalTokens === 0) {
    return (
      <Card title="Custo por Token" subtitle={`${enabled.map(e => e.engine.toUpperCase()).join(', ')} online`}>
        <div className="note">
          Nenhum token contabilizado ainda. Aguarde inferências ou verifique logs do motor.
          <br /><small>Ollama: journalctl -u ollama | vLLM/TGI: /metrics endpoint</small>
        </div>
      </Card>
    );
  }

  return (
    <Card title="Custo por Token (acumulado)" subtitle={`${enabled.map(e => e.engine.toUpperCase()).join(', ')} · ${money(energy.accumulatedCost, currency)} total`}>
      <div className="stat-row" style={{ marginBottom: 12 }}>
        <Metric label="Tokens total" value={num(totalTokens)} size="sm" />
        <Metric label="Prompt" value={num(totalPromptTokens)} size="sm" />
        <Metric label="Completion" value={num(totalCompletionTokens)} size="sm" />
        <Metric label="Energia" value={num(totalWh, 1, ' Wh')} size="sm" />
      </div>

      <div className="stat-row" style={{ marginBottom: 12 }}>
        <Metric label="Custo/token" value={cost ? `${cost.perToken.toFixed(6)} ${currency}` : NA} size="sm" />
        <Metric label="Custo/1k tokens" value={cost ? `${cost.per1k.toFixed(4)} ${currency}` : NA} size="sm" />
        <Metric label="Tokens/Wh" value={totalWh > 0 ? num(totalTokens / totalWh, 1) : NA} size="sm" />
        <Metric label="Wh/1k tokens" value={totalTokens > 0 ? num((totalWh / totalTokens) * 1000, 2) : NA} size="sm" />
      </div>

      {Object.keys(tokensByModel).length > 0 && (
        <div className="table-wrap" style={{ maxHeight: 200, overflow: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Modelo</th>
                <th className="num">Motor</th>
                <th className="num">Prompt</th>
                <th className="num">Completion</th>
                <th className="num">Total</th>
                <th className="num">Custo/1k</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(tokensByModel)
                .sort((a, b) => b[1].totalTokens - a[1].totalTokens)
                .map(([model, counts]) => {
                  const modelCost = costPerToken(totalWh, counts.totalTokens, pricePerKwh, currency);
                  return (
                    <tr key={model}>
                      <td className="mono" style={{ whiteSpace: 'nowrap', maxWidth: 200, textOverflow: 'ellipsis', overflow: 'hidden' }}>{model}</td>
                      <td className="num">{counts.engine.toUpperCase()}</td>
                      <td className="num">{num(counts.promptTokens)}</td>
                      <td className="num">{num(counts.completionTokens)}</td>
                      <td className="num"><strong>{num(counts.totalTokens)}</strong></td>
                      <td className="num">{modelCost ? `${modelCost.per1k.toFixed(4)} ${currency}` : NA}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}
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
          { label: 'Engines', value: usage.engineBytes ?? 0, color: 'var(--blue)', text: bytes(usage.engineBytes) },
          { label: 'Outros processos', value: usage.otherBytes ?? 0, color: 'var(--amber)', text: bytes(usage.otherBytes) },
          { label: 'Overhead do driver', value: usage.overheadBytes ?? 0, color: 'var(--text-faint)', text: bytes(usage.overheadBytes) },
          { label: 'Livre', value: free ?? 0, color: 'var(--track)', text: bytes(free) },
        ]}
      />
      <Legend
        items={[
          { label: 'Engines', color: 'var(--blue)', text: bytes(usage.engineBytes) },
          { label: 'Outros', color: 'var(--amber)', text: bytes(usage.otherBytes) },
          { label: 'Overhead', color: 'var(--text-faint)', text: bytes(usage.overheadBytes) },
          { label: 'Livre', color: 'var(--track)', text: bytes(free) },
        ]}
      />

      <div className="note" style={{ marginTop: 14 }}>
        {here.length > 0 ? (
          <>
            Distribuição estimada: <strong>{here.map((p) => p.model).join(', ')}</strong>.
            {' '}A associação modelo→placa é inferida cruzando a API do motor com
            a memória por processo do <span className="mono">nvidia-smi</span> — os motores não informam a GPU.
          </>
        ) : undetermined ? (
          'Não foi possível determinar a distribuição por modelo nesta placa.'
        ) : (
          'Nenhum modelo de engine alocado nesta placa.'
        )}
        {usage.overheadBytes > 0 && (
          <> O overhead de {bytes(usage.overheadBytes)} é contexto CUDA do driver, não um processo.</>
        )}
      </div>
    </Card>
  );
}
