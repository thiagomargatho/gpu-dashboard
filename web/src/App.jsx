import { useEffect, useState } from 'react';
import { useStream } from './lib/useStream.js';
import { Dot } from './components/ui.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Gpus from './pages/Gpus.jsx';
import OllamaPage from './pages/OllamaPage.jsx';
import System from './pages/System.jsx';
import Settings from './pages/Settings.jsx';
import { clockTime } from './lib/format.js';

const PAGES = [
  ['dashboard', 'Dashboard'],
  ['gpus', 'GPUs'],
  ['ollama', 'Ollama'],
  ['sistema', 'Sistema'],
  ['config', 'Configurações'],
];

/** Roteamento por hash: sem dependência, e o F5 cai na mesma aba. */
function useHashRoute() {
  const read = () => window.location.hash.replace('#/', '') || 'dashboard';
  const [route, setRoute] = useState(read);

  useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  return [PAGES.some(([k]) => k === route) ? route : 'dashboard',
    (next) => { window.location.hash = `#/${next}`; }];
}

function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light');
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('theme', theme);
  }, [theme]);
  return [theme, () => setTheme((t) => (t === 'light' ? 'dark' : 'light'))];
}

const STATUS = {
  live: { level: 'ok', text: 'ao vivo' },
  connecting: { level: 'idle', text: 'conectando' },
  reconnecting: { level: 'warn', text: 'reconectando' },
  stale: { level: 'bad', text: 'dados parados' },
};

export default function App() {
  const { snapshot, status } = useStream();
  const [route, go] = useHashRoute();
  const [theme, toggleTheme] = useTheme();

  const conn = STATUS[status] ?? STATUS.connecting;
  const thresholds = snapshot?.alertThresholds;

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">SM</span>
          Server Monitor
        </div>

        <nav className="nav">
          {PAGES.map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-current={route === key ? 'page' : undefined}
              onClick={() => go(key)}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="topbar-right">
          <span className="chip">
            <Dot level={conn.level} />
            {conn.text}
            {snapshot && <span style={{ color: 'var(--text-faint)' }}>· {clockTime(snapshot.t)}</span>}
          </span>
          <button
            className="icon-btn"
            type="button"
            onClick={toggleTheme}
            title={theme === 'light' ? 'Modo escuro' : 'Modo claro'}
            aria-label="Alternar tema"
          >
            {theme === 'light' ? '◐' : '◑'}
          </button>
        </div>
      </header>

      <main>
        {route === 'config' ? (
          <Settings />
        ) : !snapshot ? (
          <div className="empty" style={{ paddingTop: 80 }}>
            {status === 'reconnecting'
              ? 'Sem conexão com o backend. Tentando novamente…'
              : 'Aguardando a primeira coleta…'}
          </div>
        ) : (
          <>
            {route === 'dashboard' && <Dashboard snapshot={snapshot} thresholds={thresholds} />}
            {route === 'gpus' && <Gpus snapshot={snapshot} thresholds={thresholds} />}
            {route === 'ollama' && <OllamaPage snapshot={snapshot} />}
            {route === 'sistema' && <System snapshot={snapshot} thresholds={thresholds} />}
          </>
        )}
      </main>
    </>
  );
}
