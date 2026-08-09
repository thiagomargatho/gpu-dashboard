/**
 * Teste de DOM: monta o App INTEIRO num jsdom, alimentado pelo backend real.
 *
 * O smoke.jsx renderiza paginas isoladas via renderToString e nao executa
 * useEffect nenhum. Este aqui monta de verdade: roteamento, tema, o hook de
 * SSE, o ResizeObserver dos graficos e a aba Configuracoes com fetch.
 * E o que separa "compila" de "funciona".
 */
import { JSDOM } from 'jsdom';

const BASE = process.env.BASE ?? 'http://127.0.0.1:8099';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost:8099/',
  pretendToBeVisual: true,
});

const { window } = dom;

// ResizeObserver nao existe no jsdom. Devolvemos uma largura fixa para que os
// graficos SVG realmente desenhem em vez de ficarem com width = 0.
window.ResizeObserver = class {
  constructor(cb) { this.cb = cb; }
  observe(el) {
    Object.defineProperty(el, 'clientWidth', { value: 640, configurable: true });
    this.cb([{ contentRect: { width: 640 } }]);
  }
  disconnect() {}
};

// EventSource tambem nao existe: esta implementacao faz polling no /api/metrics
// e entrega no mesmo formato que o SSE do backend entregaria.
window.EventSource = class {
  constructor() {
    this.onmessage = null;
    this.onopen = null;
    this.onerror = null;
    this._timer = setInterval(async () => {
      try {
        const res = await fetch(`${BASE}/api/metrics`);
        const text = await res.text();
        this.onopen?.();
        this.onmessage?.({ data: text });
      } catch (err) {
        this.onerror?.(err);
      }
    }, 300);
  }

  close() { clearInterval(this._timer); }
};

// O app faz fetch em caminho relativo ('/api/config', '/api/history'), que o
// navegador resolve contra a origem mas o fetch do Node rejeita. Precisa valer
// no globalThis, e nao so no window: e de la que o codigo do React resolve.
const nodeFetch = globalThis.fetch;
const relativeFetch = (input, init) => nodeFetch(
  typeof input === 'string' && input.startsWith('/') ? `${BASE}${input}` : input,
  init,
);
window.fetch = relativeFetch;
globalThis.fetch = relativeFetch;

globalThis.window = window;
globalThis.document = window.document;
globalThis.navigator = window.navigator;
globalThis.localStorage = window.localStorage;
globalThis.ResizeObserver = window.ResizeObserver;
globalThis.EventSource = window.EventSource;
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);

// Qualquer console.error do React (chave faltando, hook fora de ordem, acesso a
// undefined) reprova o teste — sao exatamente os erros que quebram a tela.
const problems = [];
const realError = console.error;
console.error = (...args) => {
  problems.push(args.map(String).join(' '));
  realError('  [console.error]', ...args);
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
const check = (label, condition, detail = '') => {
  if (condition) {
    console.log(`✓ ${label}`);
  } else {
    console.log(`✗ ${label}${detail ? ` — ${detail}` : ''}`);
    failed += 1;
  }
};

const text = () => document.body.textContent;
const html = () => document.body.innerHTML;

async function main() {
// Importados so depois de os globais do jsdom existirem.
const { createRoot } = await import('react-dom/client');
const { default: App } = await import('../src/App.jsx');
const { createElement } = await import('react');

const root = createRoot(document.getElementById('root'));
root.render(createElement(App));

await wait(1500);

// ---- Dashboard ----
check('App monta e mostra o cabecalho', text().includes('Server Monitor'));
check('conexao reportada como ao vivo', text().includes('ao vivo'), text().slice(0, 120));
check('placa identificada', text().includes('RTX 3060'));
check('GPU offline sinalizada', text().includes('Fora do barramento'));
check('GPU offline explica o motivo', text().includes('não responde ao driver'));
check('cartao de energia presente', text().includes('Energia'));
check('disclaimer de energia visivel', text().includes('não representa o consumo total'));
check('secao de VRAM por GPU', text().includes('VRAM por GPU'));
check('alerta da GPU 0 no topo', text().includes('Recuperação exige reiniciar o servidor'));

// ---- GPUs ----
window.location.hash = '#/gpus';
window.dispatchEvent(new window.HashChangeEvent('hashchange'));
await wait(1200);
check('aba GPUs abre', text().includes('Histórico por GPU'));
check('graficos SVG desenhados', html().includes('<svg'), 'nenhum <svg> no DOM');
check('linha do grafico tem caminho', /<path[^>]+d="M/.test(html()), 'path sem geometria');
check('tabela de processos GPU', text().includes('Processos GPU'));
check('processo do ollama listado', text().includes('llama-server'));
check('P-state exibido', text().includes('P-state'));

// ---- Ollama ----
window.location.hash = '#/ollama';
window.dispatchEvent(new window.HashChangeEvent('hashchange'));
await wait(1200);
check('aba Ollama abre', text().includes('Modelos instalados'));
check('modelos ativos listados', text().includes('Modelos ativos na memória'));
check('keep_alive infinito traduzido', text().includes('Permanente'));
check('modelo em CPU sinalizado', text().includes('CPU (RAM)') || text().includes('CPU'));

// ---- Sistema ----
window.location.hash = '#/sistema';
window.dispatchEvent(new window.HashChangeEvent('hashchange'));
await wait(1200);
check('aba Sistema abre', text().includes('Interfaces de rede'));
check('hostname exibido', text().includes('servidor'));
check('sensor de temperatura identificado', text().includes('x86_pkg_temp'));

// ---- Configuracoes ----
window.location.hash = '#/config';
window.dispatchEvent(new window.HashChangeEvent('hashchange'));
await wait(1500);
check('aba Configuracoes carrega', text().includes('Preço do kWh'));
check('campos somente-leitura exibidos', text().includes('Somente leitura'));
check('config carregada do backend (nao ficou no spinner)',
  !text().includes('Carregando configuração'));

// ---- Tema escuro ----
const themeBtn = [...document.querySelectorAll('.icon-btn')][0];
themeBtn?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(400);
check('alternancia de tema funciona', document.documentElement.dataset.theme === 'dark',
  `data-theme=${document.documentElement.dataset.theme}`);

// ---- Erros do React ----
check('nenhum erro do React', problems.length === 0, problems.slice(0, 3).join(' | '));
check('nenhum "undefined" vazado na tela', !text().includes('undefined'));
check('nenhum NaN na tela', !text().includes('NaN'));

console.log(failed ? `\n${failed} verificacao(oes) falharam` : '\nTodas as verificacoes passaram');
process.exit(failed ? 1 : 0);
}

main();
