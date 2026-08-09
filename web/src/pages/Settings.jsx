import { useEffect, useState } from 'react';
import { Card, KeyValues } from '../components/ui.jsx';

const FIELDS = [
  {
    key: 'energy.pricePerKwh',
    label: 'Preço do kWh',
    help: 'Usado só para estimar custo. Não muda nenhuma medição.',
    step: '0.01',
  },
  { key: 'alerts.gpuTempC', label: 'Alerta de temperatura da GPU (°C)', step: '1' },
  { key: 'alerts.gpuVramPercent', label: 'Alerta de VRAM (%)', step: '1' },
  { key: 'alerts.gpuUtilPercent', label: 'Alerta de utilização da GPU (%)', step: '1' },
  {
    key: 'alerts.gpuUtilSustainedSeconds',
    label: 'Tempo contínuo para alertar utilização (s)',
    help: 'Um pico de 2 s em 100% é inferência normal; o alerta só dispara se persistir.',
    step: '10',
  },
  { key: 'alerts.gpuPowerPercent', label: 'Alerta de consumo perto do limite (%)', step: '1' },
  { key: 'alerts.ramPercent', label: 'Alerta de RAM (%)', step: '1' },
  { key: 'alerts.diskFreePercent', label: 'Alerta de disco livre abaixo de (%)', step: '1' },
];

export default function Settings() {
  const [config, setConfig] = useState(null);
  const [values, setValues] = useState({});
  const [state, setState] = useState({ saving: false, message: null, error: null });

  const load = async () => {
    try {
      const res = await fetch('/api/config');
      const data = await res.json();
      setConfig(data);
      const next = {};
      for (const f of FIELDS) {
        const [group, field] = f.key.split('.');
        next[f.key] = data.editable[group]?.[field];
      }
      setValues(next);
    } catch (err) {
      setState((s) => ({ ...s, error: `não foi possível ler a configuração: ${err.message}` }));
    }
  };

  useEffect(() => { load(); }, []);

  const save = async (event) => {
    event.preventDefault();
    setState({ saving: true, message: null, error: null });
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          Object.fromEntries(Object.entries(values).map(([k, v]) => [k, Number(v)])),
        ),
      });
      const data = await res.json();
      if (!res.ok) {
        setState({ saving: false, message: null, error: (data.details ?? [data.error]).join(' · ') });
        return;
      }
      setState({ saving: false, message: 'Configuração salva em config.json.', error: null });
      load();
    } catch (err) {
      setState({ saving: false, message: null, error: err.message });
    }
  };

  if (!config) {
    return <div className="empty">Carregando configuração…</div>;
  }

  const ro = config.readOnly;

  const engineRows = [];
  if (ro.ollama?.enabled) engineRows.push(['Ollama', `${ro.ollama.host}:${ro.ollama.port}`]);
  if (ro.vllm?.enabled) engineRows.push(['vLLM', `${ro.vllm.host}:${ro.vllm.port}`]);
  if (ro.tgi?.enabled) engineRows.push(['TGI', `${ro.tgi.host}:${ro.tgi.port}`]);
  if (ro.llamaCpp?.enabled) engineRows.push(['llama.cpp', `${ro.llamaCpp.host}:${ro.llamaCpp.port}`]);
  if (ro.localai?.enabled) engineRows.push(['LocalAI', `${ro.localai.host}:${ro.localai.port}`]);
  if (ro.koboldcpp?.enabled) engineRows.push(['KoboldCPP', `${ro.koboldcpp.host}:${ro.koboldcpp.port}`]);
  if (engineRows.length === 0) engineRows.push(['Nenhum motor habilitado', '—']);

  return (
    <>
      <div className="section-title">Configurações</div>
      <div className="grid grid-2">
        <Card title="Ajustáveis pela interface" subtitle="gravadas em config.json">
          <form onSubmit={save}>
            {FIELDS.map((f) => {
              const limit = config.limits[f.key];
              return (
                <div className="field" key={f.key}>
                  <label htmlFor={f.key}>{f.label}</label>
                  <input
                    id={f.key}
                    type="number"
                    step={f.step}
                    min={limit?.min}
                    max={limit?.max}
                    value={values[f.key] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  />
                  <small>
                    {f.help ? `${f.help} ` : ''}
                    {limit && `Faixa aceita: ${limit.min} a ${limit.max}.`}
                  </small>
                </div>
              );
            })}

            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button className="btn" type="submit" disabled={state.saving}>
                {state.saving ? 'Salvando…' : 'Salvar'}
              </button>
              {state.message && <span className="text-ok">{state.message}</span>}
              {state.error && <span className="text-bad">{state.error}</span>}
            </div>
          </form>
        </Card>

        <div>
          <Card title="Somente leitura" subtitle="editar exige alterar config.json e reiniciar o serviço">
            <KeyValues
              rows={[
                ['Porta da aplicação', String(ro.port)],
                ['Host de escuta', ro.host],
                ...engineRows,
                ['Intervalo de coleta', `${ro.collect.intervalMs} ms`],
                ['Janela de histórico', `${ro.collect.historyMinutes} min`],
                ['Ponto de montagem monitorado', ro.disk.mount],
                ['Arquivo de log', ro.log.file],
                ['Rotação do log', `${(ro.log.maxBytes / 1048576).toFixed(0)} MB · ${ro.log.keep} arquivos`],
              ]}
            />
          </Card>

          <Card title="Por que estes campos não são editáveis aqui?" style={{ marginTop: 16 }}>
            <div className="note">
              Porta, host, caminho de log e endereço do Ollama definem <em>onde o processo escuta e o
              que ele abre no disco</em>. Aceitar isso por HTTP daria ao navegador poder de
              reconfigurar o serviço — e esta dashboard é de monitoramento. Os campos da esquerda
              são só limiares de exibição e o preço do kWh: nenhum deles toca no servidor.
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
