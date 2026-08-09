# gpu-dashboard

Monitoramento em tempo real do servidor: sistema, **todas as GPUs NVIDIA detectadas** e o Ollama. **Somente leitura** — não carrega, descarrega nem altera modelo nenhum, não mexe em power limit e não mata processo.

```
http://SEU_IP:8099
```

## Arquitetura

| Camada | Escolha | Por quê |
|---|---|---|
| Backend | Node 20, **zero dependências** | Node já estava instalado; `nvidia-smi --query-gpu` devolve CSV estruturado, então NVML via Python (que exigiria instalar `pip` + `pynvml`) não pagaria a dependência |
| Frontend | React 18 + Vite | pedido no escopo; build estático servido pelo próprio backend |
| Gráficos | SVG escrito à mão | evita Recharts/D3 — o bundle inteiro fica em 57 KB gzip |
| Transporte | SSE (`/api/stream`) | unidirecional, reconecta sozinho, mais simples que WebSocket |
| Histórico | buffer circular em memória | 60 min a cada 2 s ≈ 1800 amostras por GPU; sem banco |

```
server/
  index.js      HTTP, rotas, SSE, arquivos estáticos
  collector.js  laço de 2s, buffer circular, energia, correlação Ollama↔GPU
  nvidia.js     nvidia-smi (query-gpu, compute-apps) + inventário PCI (detecta todas as GPUs NVIDIA)
  system.js     /proc, /sys e df — sem lm-sensors
  ollama.js     /api/version, /api/tags, /api/ps + varredura de /proc
  alerts.js     limiares → alertas
  config.js     carga, allowlist e validação do config.json
  logger.js     log com rotação, registra transição e não estado
web/            React + Vite (build vai para web/dist)
```

## Instalação

Duas formas. A que está em uso nesta máquina é a primeira.

### Serviço de usuário — sem sudo (em uso)

```bash
loginctl enable-linger "$USER"          # faz o systemd do usuário subir no boot
systemctl --user enable --now gpu-dashboard
```

A unit vive em `~/.config/systemd/user/gpu-dashboard.service`. O *linger* é o
que faz a diferença: sem ele o systemd do usuário só existe enquanto há sessão
aberta, e a dashboard não voltaria depois de um reboot sem login. O
`loginctl enable-linger` não pede senha — o polkit do Ubuntu deixa o usuário
habilitar isso para si mesmo.

```bash
systemctl --user status gpu-dashboard
journalctl --user -u gpu-dashboard -f
```

### Serviço de sistema — precisa de sudo

```bash
bash install.sh
```

Verifica dependências, instala, compila o frontend, gera a unit com os caminhos
reais, habilita e sobe. Detecta e desativa a versão de usuário antes, para as
duas não brigarem pela porta. Vale a pena se você quiser o serviço rodando
mesmo com a conta desabilitada, ou ordenado explicitamente contra
`network-online.target`. Para o uso normal, a versão de usuário basta.

```bash
systemctl status gpu-dashboard
journalctl -u gpu-dashboard -f
tail -f logs/gpu-dashboard.log
```

## Endpoints

| Método | Rota | Devolve |
|---|---|---|
| GET | `/api/health` | `{status, ollama, nvidia, gpu_count, gpu_online, uptime_seconds, alerts}` — `gpu_count` reflete **todas as GPUs NVIDIA no barramento PCI** |
| GET | `/api/metrics` | snapshot completo da última coleta |
| GET | `/api/history?range=5m\|15m\|30m\|60m` | séries por GPU, reamostradas para ≤240 pontos |
| GET | `/api/stream` | SSE, um evento a cada 2 s |
| GET | `/api/config` | configuração, separada em editável e somente-leitura |
| POST | `/api/config` | grava apenas chaves da allowlist, cada uma validada por faixa |

## Decisões que valem saber

**Uma GPU fora do barramento não some da tela.** O `nvidia-smi --query-gpu`
**sai com código 0** mesmo quando uma placa caiu: ele apenas omite a linha e
escreve o erro no stderr. Ler só o stdout faria a dashboard mostrar "1 GPU" e
passar a impressão de que está tudo certo. O coletor monta a lista a partir do
`lspci` e cruza com o stderr, então a placa aparece marcada como *fora do
barramento*, com todos os campos em `—`.

**Nada é inventado.** Todo sensor ausente vira `null` no backend e `—` na tela.
Nenhum campo cai para zero para "ficar bonito" — zero e desconhecido são coisas
diferentes, principalmente em temperatura e ventoinha.

**Modelo → GPU é estimativa, e diz que é.** O `/api/ps` do Ollama não informa em
qual placa o modelo está. A associação é inferida cruzando o `size_vram` com a
memória por processo do `nvidia-smi`. A janela é assimétrica (0,95× a 1,6×)
porque a alocação real é sempre maior que o `size_vram`: o processo também
reserva contexto CUDA e buffers de cálculo — medido aqui, `gestao360` declara
5,73 GB e o `llama-server` ocupa 6,94 GB. Quando o casamento não é único, o
campo vira *indeterminado* em vez de chutar.

**Overhead do driver aparece separado.** A diferença entre `memory.used` e a
soma dos processos (uns 9 MiB) é contexto CUDA, não processo — sai numa faixa
própria para não ser lida como "outro programa usando a placa".

**Energia é só das GPUs.** O número vem exclusivamente do `power.draw` do
`nvidia-smi`. Não inclui CPU, placa-mãe, discos, ventoinhas nem perdas da
fonte, e a tela diz isso.

**O log registra transição, não estado.** Um "Ollama offline" a cada 2 s encheria
o disco em minutos. Só a mudança é gravada, com rotação em 2 MB × 3 arquivos.

**Unidades.** VRAM, RAM e disco em base binária (é o que `nvidia-smi`, `free -h`
e `df -h` mostram). Tamanho de modelo do Ollama em base decimal, para bater com
o que o `ollama list` imprime no terminal.

## Segurança

Uso em LAN. O backend **não executa nada vindo do navegador**: todas as chamadas
externas são `execFile` com argumentos fixos (`nvidia-smi`, `df`, `lspci`) —
nunca `shell`, nunca com string do cliente. O `POST /api/config` aceita apenas
uma allowlist de chaves numéricas, cada uma validada por faixa; porta, host,
endereço do Ollama e caminho de log **não** são editáveis pela rede, porque
definem onde o processo escuta e o que ele abre em disco. Arquivos estáticos são
resolvidos e conferidos contra o prefixo de `web/dist`.

## Testes

```bash
npm test          # exige o backend no ar (npm start em outro terminal)
```

Dois níveis, ambos contra o backend **real** — nada de dados simulados:

- `web/test/smoke.jsx` renderiza as quatro páginas com o payload do
  `/api/metrics` via `react-dom/server` e falha se algum `undefined`, `NaN` ou
  `[object Object]` vazar para o HTML.
- `web/test/dom.jsx` monta o **App inteiro** num jsdom e navega pelas cinco
  abas: roteamento, tema, o hook de SSE, os gráficos SVG e a aba Configurações
  com `fetch`. Qualquer `console.error` do React reprova. É o que separa
  "compila" de "funciona".

O jsdom é dependência só de desenvolvimento — não entra no bundle nem no
runtime do servidor, que continua sem dependência alguma.

## Configuração

`config.json`. Porta, host, endereço do Ollama, intervalo de coleta, janela de
histórico, limiares de alerta, preço do kWh e rotação de log. Limiares e preço
também são editáveis pela aba **Configurações**; o resto exige editar o arquivo
e reiniciar o serviço.
