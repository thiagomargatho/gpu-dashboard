import { Card, Chip, Empty, KeyValues, Metric } from '../components/ui.jsx';
import {
  NA, bytes, dateTime, duration, expiry, num, pct,
} from '../lib/format.js';

export default function OllamaPage({ snapshot }) {
  const { ollama, modelPlacement } = snapshot;
  const undetermined = modelPlacement.filter((p) => p.confidence === 'indeterminado');
  // Derivados via Modelfile compartilham os blobs de peso com o modelo base.
  const derived = ollama.models.filter((m) => m.parentModel);

  return (
    <>
      <div className="section-title">Ollama</div>
      <div className="grid grid-2">
        <Card
          title="Serviço"
          subtitle={ollama.url}
          right={<Chip level={ollama.online ? 'ok' : 'bad'}>{ollama.online ? 'Online' : 'Offline'}</Chip>}
        >
          <KeyValues
            rows={[
              ['Versão', ollama.version ?? NA],
              ['Endereço da API', <span key="u" className="mono">{ollama.url}</span>],
              ['Uptime do processo', duration(ollama.uptimeSeconds)],
              ['CPU (todos os processos)', pct(ollama.cpuPercent, 1)],
              ['RAM residente', bytes(ollama.rssBytes)],
              ['Processos ativos', String(ollama.processes.length)],
              ['Modelos instalados', String(ollama.models.length)],
              ['Modelos carregados', String(ollama.loaded.length)],
            ]}
          />
          {ollama.error && (
            <div className="note" style={{ marginTop: 14, color: 'var(--red)' }}>{ollama.error}</div>
          )}
        </Card>

        <Card title="Processos do Ollama" className="card-pad-0">
          {ollama.processes.length === 0 ? (
            <Empty>Nenhum processo do Ollama em execução.</Empty>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th className="num">PID</th>
                    <th>Processo</th>
                    <th className="num">CPU</th>
                    <th className="num">RAM</th>
                    <th className="num">Uptime</th>
                  </tr>
                </thead>
                <tbody>
                  {ollama.processes.map((p) => (
                    <tr key={p.pid}>
                      <td className="num mono">{p.pid}</td>
                      <td>{p.name}</td>
                      <td className="num">{pct(p.cpuPercent, 1)}</td>
                      <td className="num">{bytes(p.rssBytes)}</td>
                      <td className="num">{duration(p.uptimeSeconds)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <div className="section-title">Modelos ativos na memória</div>
      <Card className="card-pad-0">
        {ollama.loaded.length === 0 ? (
          <Empty>Nenhum modelo carregado. Nada ocupando VRAM pelo Ollama.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Modelo</th>
                  <th>Onde está</th>
                  <th className="num">Tamanho</th>
                  <th className="num">VRAM</th>
                  <th className="num">Contexto</th>
                  <th className="num">Descarrega em</th>
                </tr>
              </thead>
              <tbody>
                {ollama.loaded.map((m) => {
                  const place = modelPlacement.find((p) => p.model === m.name);
                  return (
                    <tr key={m.name}>
                      <td>
                        {m.name}
                        {m.quantization && (
                          <span style={{ color: 'var(--text-faint)' }}> · {m.quantization}</span>
                        )}
                      </td>
                      <td>
                        {m.placement === 'cpu' && <Chip>CPU (RAM)</Chip>}
                        {m.placement === 'gpu' && (
                          <Chip level="info">
                            {place?.gpuIndex != null ? `GPU ${place.gpuIndex} (estimado)` : 'GPU indeterminada'}
                          </Chip>
                        )}
                        {m.placement === 'hibrido' && <Chip level="warn">CPU + GPU</Chip>}
                      </td>
                      <td className="num">{bytes(m.sizeBytes, { binary: false })}</td>
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
      </Card>

      <div className="note" style={{ marginTop: 12 }}>
        A coluna <strong>Onde está</strong> vem do campo <span className="mono">size_vram</span> do
        {' '}<span className="mono">/api/ps</span>: zero significa modelo residente em RAM, rodando em CPU.
        {' '}O Ollama <strong>não informa em qual placa</strong> o modelo está — o número da GPU é inferido
        cruzando o tamanho declarado com a memória por processo do <span className="mono">nvidia-smi</span>,
        por isso aparece marcado como estimado.
        {undetermined.length > 0 && (
          <> Não foi possível determinar a placa de: <strong>{undetermined.map((p) => p.model).join(', ')}</strong>.</>
        )}
        {' '}<strong>Descarrega em «Permanente»</strong> corresponde a <span className="mono">keep_alive</span> infinito:
        o modelo fica ocupando memória mesmo sem receber requisição.
      </div>

      <div className="section-title">Modelos instalados</div>
      <Card className="card-pad-0">
        {ollama.models.length === 0 ? (
          <Empty>Nenhum modelo instalado.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Modelo</th>
                  <th>Família</th>
                  <th>Parâmetros</th>
                  <th>Quantização</th>
                  <th className="num">Tamanho em disco</th>
                  <th className="num">Contexto máx.</th>
                  <th className="num">Modificado</th>
                </tr>
              </thead>
              <tbody>
                {ollama.models.map((m) => {
                  const loaded = ollama.loaded.some((l) => l.name === m.name);
                  return (
                    <tr key={m.name}>
                      <td>
                        {m.name} {loaded && <Chip level="ok">carregado</Chip>}
                        {m.parentModel && (
                          <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>base: {m.parentModel}</div>
                        )}
                      </td>
                      <td>{m.family ?? NA}</td>
                      <td>{m.parameterSize ?? NA}</td>
                      <td>{m.quantization ?? NA}</td>
                      <td className="num">{bytes(m.sizeBytes, { binary: false })}</td>
                      <td className="num">{num(m.contextLength)}</td>
                      <td className="num">{dateTime(m.modifiedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid grid-4" style={{ marginTop: 16 }}>
        <Card>
          <Metric
            label="Soma declarada dos modelos"
            value={bytes(ollama.models.reduce((a, m) => a + (m.sizeBytes ?? 0), 0), { binary: false })}
            size="sm"
            hint={`${ollama.models.length} modelos · não é o uso em disco`}
          />
          <div className="note" style={{ marginTop: 10 }}>
            O Ollama guarda os pesos por conteúdo: modelos derivados do mesmo base
            {derived.length > 0 && <> (aqui, <strong>{derived.length}</strong> deles)</>}
            {' '}apontam para o <strong>mesmo blob</strong>. Esta soma conta o blob uma vez por
            modelo, então o disco real é bem menor. Para medir:
            {' '}<span className="mono">sudo du -sh /usr/share/ollama/.ollama/models/blobs</span>
          </div>
        </Card>
        <Card>
          <Metric
            label="VRAM ocupada pelo Ollama"
            value={bytes(ollama.loaded.reduce((a, m) => a + (m.vramBytes ?? 0), 0))}
            size="sm"
            hint="soma do size_vram dos modelos carregados"
          />
        </Card>
      </div>
    </>
  );
}
