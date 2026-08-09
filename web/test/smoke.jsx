/**
 * Smoke test das paginas contra os dados REAIS do backend.
 *
 * Nao substitui olhar a tela, mas executa todo o caminho de acesso a dados e
 * formatacao de cada pagina — que e onde mora a maioria dos erros ("cannot read
 * property of null" quando uma GPU esta offline, por exemplo). Roda sem
 * navegador: os hooks de efeito nao disparam no renderToString.
 */
import { renderToString } from 'react-dom/server';
import Dashboard from '../src/pages/Dashboard.jsx';
import Gpus from '../src/pages/Gpus.jsx';
import EnginesPage from '../src/pages/EnginesPage.jsx';
import System from '../src/pages/System.jsx';

const BASE = process.env.BASE ?? 'http://127.0.0.1:8099';

// O React reclama de useLayoutEffect no servidor; e esperado e nao afeta o teste.
const realError = console.error;
console.error = (...args) => {
  if (String(args[0]).includes('useLayoutEffect does nothing on the server')) return;
  realError(...args);
};

async function main() {
  const res = await fetch(`${BASE}/api/metrics`);
  if (!res.ok) {
    console.error(`backend respondeu ${res.status} — suba o servidor antes`);
    process.exit(1);
  }
  const snapshot = await res.json();
  const thresholds = snapshot.alertThresholds;

  const PAGES = [
    ['Dashboard', <Dashboard snapshot={snapshot} thresholds={thresholds} />],
    ['GPUs', <Gpus snapshot={snapshot} thresholds={thresholds} />],
    ['Motores', <EnginesPage snapshot={snapshot} />],
    ['Sistema', <System snapshot={snapshot} thresholds={thresholds} />],
  ];

  let failed = 0;

  for (const [name, element] of PAGES) {
    try {
      const html = renderToString(element);

      // Vazamentos classicos de formatacao: se um destes aparece no HTML, algum
      // valor nulo escapou dos helpers em vez de virar "—".
      const leaks = ['undefined', 'NaN', '[object Object]']
        .filter((needle) => html.includes(needle));

      if (leaks.length) {
        console.log(`✗ ${name}: vazou ${leaks.join(', ')} no HTML`);
        for (const needle of leaks) {
          const i = html.indexOf(needle);
          console.log(`    …${html.slice(Math.max(0, i - 110), i + 50).replace(/<[^>]+>/g, ' ')}…`);
        }
        failed += 1;
      } else {
        console.log(`✓ ${name}: ${html.length} bytes, sem valores vazados`);
      }
    } catch (err) {
      console.log(`✗ ${name}: EXCECAO ${err.message}`);
      console.log(err.stack.split('\n').slice(1, 4).join('\n'));
      failed += 1;
    }
  }

  // A GPU 0 esta fora do barramento: e o caminho mais facil de quebrar, entao
  // checamos explicitamente que ele foi exercitado.
  const offline = snapshot.gpus.filter((g) => g.status !== 'ok');
  console.log(offline.length
    ? `· caminho de GPU offline exercitado (GPU ${offline.map((g) => g.index).join(', ')})`
    : '· nenhuma GPU offline neste snapshot — caminho de erro NAO exercitado');

  process.exit(failed ? 1 : 0);
}

main();
