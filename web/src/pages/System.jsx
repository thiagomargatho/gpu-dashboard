import { Bar, Card, KeyValues, Metric } from '../components/ui.jsx';
import { Spark, useTrail } from '../components/Chart.jsx';
import { NA, bytes, bytesNum, duration, num, pct } from '../lib/format.js';

export default function System({ snapshot, thresholds }) {
  const sys = snapshot.system;
  const cpuTrail = useTrail(sys.cpu.percent);

  return (
    <>
      <div className="section-title">Sistema</div>
      <div className="grid grid-3">
        <Card title="CPU" subtitle={sys.cpu.model ?? NA}>
          <Metric label="Uso total" value={pct(sys.cpu.percent)} />
          <Bar percent={sys.cpu.percent} level={sys.cpu.percent >= 90 ? 'warn' : 'ok'} />
          <Spark points={cpuTrail} domainMax={100} />
          <KeyValues
            rows={[
              ['Núcleos físicos', sys.cpu.cores == null ? NA : String(sys.cpu.cores)],
              ['Threads', sys.cpu.threads == null ? NA : String(sys.cpu.threads)],
              ['Load 1 / 5 / 15 min', `${sys.load.one} · ${sys.load.five} · ${sys.load.fifteen}`],
              ['Load por thread', num(sys.load.perCore, 2)],
              ['Temperatura', sys.temperature ? `${sys.temperature.celsius} °C` : NA],
              ['Fonte do sensor', sys.temperature?.source ?? 'nenhum sensor disponível'],
            ]}
          />
        </Card>

        <Card title="Memória">
          <Metric
            label="RAM em uso"
            value={`${bytesNum(sys.memory?.usedBytes)} / ${bytesNum(sys.memory?.totalBytes)}`}
            unit="GB"
            hint={pct(sys.memory?.percent)}
          />
          <Bar
            percent={sys.memory?.percent}
            level={sys.memory?.percent >= (thresholds?.ramPercent ?? 90) ? 'bad' : 'ok'}
          />
          <KeyValues
            rows={[
              ['Total', bytes(sys.memory?.totalBytes)],
              ['Disponível', bytes(sys.memory?.availableBytes)],
              ['Livre', bytes(sys.memory?.freeBytes)],
              ['Cache + buffers', bytes(sys.memory?.cachedBytes)],
              ['Swap usada', bytes(sys.memory?.swapUsedBytes)],
              ['Swap livre', bytes(sys.memory?.swapFreeBytes)],
              ['Swap total', bytes(sys.memory?.swapTotalBytes)],
            ]}
          />
          <Bar percent={sys.memory?.swapPercent} level={sys.memory?.swapPercent >= 50 ? 'warn' : 'ok'} />
          <div className="metric-hint">Swap em {pct(sys.memory?.swapPercent, 1)}</div>
        </Card>

        <Card title="Disco" subtitle={sys.disk ? `${sys.disk.filesystem} em ${sys.disk.mount}` : NA}>
          <Metric
            label="Uso"
            value={`${bytesNum(sys.disk?.usedBytes, { digits: 0 })} / ${bytesNum(sys.disk?.totalBytes, { digits: 0 })}`}
            unit="GB"
            hint={pct(sys.disk?.percent)}
          />
          <Bar
            percent={sys.disk?.percent}
            level={sys.disk?.freePercent <= (thresholds?.diskFreePercent ?? 10) ? 'bad' : 'ok'}
          />
          <KeyValues
            rows={[
              ['Total', bytes(sys.disk?.totalBytes)],
              ['Usado', bytes(sys.disk?.usedBytes)],
              ['Livre', bytes(sys.disk?.freeBytes)],
              ['Livre %', pct(sys.disk?.freePercent, 1)],
            ]}
          />
        </Card>
      </div>

      <div className="section-title">Identificação e rede</div>
      <div className="grid grid-2">
        <Card title="Servidor">
          <KeyValues
            rows={[
              ['Hostname', sys.hostname],
              ['Plataforma', sys.platform],
              ['Uptime', duration(sys.uptimeSeconds)],
              ['IP principal', <span key="ip" className="mono">{sys.network.primary ?? NA}</span>],
              ['Driver NVIDIA', snapshot.nvidia.driverVersion ?? NA],
              ['CUDA', snapshot.nvidia.cudaVersion ?? NA],
              ['GPUs no barramento', String(snapshot.gpus.length)],
              ['GPUs respondendo', String(snapshot.gpus.filter((g) => g.status === 'ok').length)],
              ['Coletor ativo há', duration(snapshot.collectorUptimeSeconds)],
            ]}
          />
        </Card>

        <Card title="Interfaces de rede" className="card-pad-0">
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Interface</th><th>Endereço IPv4</th></tr>
              </thead>
              <tbody>
                {sys.network.all.map((a) => (
                  <tr key={`${a.iface}-${a.address}`}>
                    <td>{a.iface}</td>
                    <td className="mono">
                      {a.address}
                      {a.address === sys.network.primary && (
                        <span style={{ color: 'var(--text-faint)' }}> · principal</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
