import { Card, Chip, Empty, KeyValues, Metric } from '../components/ui.jsx';
import { NA, pct, num, bytes, mib } from '../lib/format.js';

export default function EnginesPage({ snapshot }) {
  const { engines, system } = snapshot;

  if (!engines || !engines.length) {
    return (
      <>
        <div className="section-title">Motores de Inferência</div>
        <Card>
          <Empty>Nenhum motor de inferência habilitado no config.json</Empty>
        </Card>
      </>
    );
  }

  const enabledEngines = engines.filter(e => e.enabled);

  return (
    <>
      <div className="section-title">Motores de Inferência</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 16 }}>
        {enabledEngines.map((engine) => (
          <EngineCard key={engine.engine} engine={engine} system={system} />
        ))}
      </div>
    </>
  );
}

function EngineCard({ engine, system }) {
  const isOnline = engine.online;
  const procCount = engine.processes?.length ?? 0;

  return (
    <Card
      title={engine.engine.toUpperCase()}
      subtitle={engine.url}
      right={<Chip level={isOnline ? 'ok' : 'bad'}>{isOnline ? 'Online' : 'Offline'}</Chip>}
    >
      {engine.error && (
        <div style={{ color: 'var(--red)', marginBottom: 12, fontSize: '0.85rem' }}>
          Erro: {engine.error}
        </div>
      )}

      <KeyValues
        rows={[
          ['Versão', engine.version ?? NA],
          ['Processos ativos', num(procCount)],
          ['CPU total', engine.cpuPercent != null ? pct(engine.cpuPercent) : NA],
          ['RAM (RSS)', engine.rssBytes != null ? bytes(engine.rssBytes) : NA],
          ['Uptime', engine.uptimeSeconds != null ? `${Math.round(engine.uptimeSeconds / 60)} min` : NA],
          ['Modelos instalados', num(engine.models?.length)],
          ['Modelos carregados', num(engine.loaded?.length)],
        ]}
      />

      {engine.models?.length && (
        <div style={{ marginTop: 16 }}>
          <div className="section-title" style={{ fontSize: '0.8rem', marginBottom: 8 }}>Modelos instalados</div>
          <div className="table-wrap" style={{ maxHeight: 200, overflow: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th className="num">Tamanho</th>
                  <th>Família</th>
                  <th>Quantização</th>
                  <th>Formato</th>
                  <th className="num">Contexto</th>
                </tr>
              </thead>
              <tbody>
                {engine.models.map((m, i) => (
                  <tr key={i}>
                    <td className="mono" style={{ whiteSpace: 'nowrap' }}>{m.name}</td>
                    <td className="num">{m.sizeBytes != null ? bytes(m.sizeBytes) : NA}</td>
                    <td>{m.family ?? NA}</td>
                    <td>{m.quantization ?? NA}</td>
                    <td>{m.format ?? NA}</td>
                    <td className="num">{m.contextLength != null ? num(m.contextLength) : NA}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {engine.loaded?.length && (
        <div style={{ marginTop: 16 }}>
          <div className="section-title" style={{ fontSize: '0.8rem', marginBottom: 8 }}>Modelos carregados (VRAM)</div>
          <div className="table-wrap" style={{ maxHeight: 200, overflow: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th className="num">VRAM</th>
                  <th>Localização</th>
                  <th className="num">Contexto</th>
                  <th>Quantização</th>
                </tr>
              </thead>
              <tbody>
                {engine.loaded.map((m, i) => (
                  <tr key={i}>
                    <td className="mono" style={{ whiteSpace: 'nowrap' }}>{m.name}</td>
                    <td className="num">{m.vramBytes != null ? bytes(m.vramBytes) : NA}</td>
                    <td>
                      <Chip level={m.placement === 'gpu' ? 'ok' : m.placement === 'hibrido' ? 'warn' : 'info'}>
                        {m.placement?.toUpperCase() ?? NA}
                      </Chip>
                    </td>
                    <td className="num">{m.contextLength != null ? num(m.contextLength) : NA}</td>
                    <td>{m.quantization ?? NA}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {engine.processes?.length && (
        <div style={{ marginTop: 16 }}>
          <div className="section-title" style={{ fontSize: '0.8rem', marginBottom: 8 }}>Processos ({engine.engine})</div>
          <Card className="card-pad-0">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th className="num">PID</th>
                    <th>Processo</th>
                    <th className="num">CPU%</th>
                    <th className="num">RAM</th>
                    <th>Uptime</th>
                    <th>Cmdline</th>
                  </tr>
                </thead>
                <tbody>
                  {engine.processes.map((p) => (
                    <tr key={p.pid}>
                      <td className="num mono">{p.pid}</td>
                      <td>{p.name ?? p.command ?? NA}</td>
                      <td className="num">{p.cpuPercent != null ? pct(p.cpuPercent) : NA}</td>
                      <td className="num">{p.rssBytes != null ? bytes(p.rssBytes) : NA}</td>
                      <td>{p.uptimeSeconds != null ? `${Math.round(p.uptimeSeconds / 60)} min` : NA}</td>
                      <td className="mono" style={{ color: 'var(--text-faint)', maxWidth: 300, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                        {p.cmdline ?? NA}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {!engine.models?.length && !engine.loaded?.length && !engine.processes?.length && isOnline && (
        <div style={{ marginTop: 16, color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          Motor online mas sem modelos, processos ou cargas visíveis.
        </div>
      )}
    </Card>
  );
}