import { useEffect, useRef, useState } from 'react';

/**
 * SSE com o estado da conexão exposto. O EventSource já reconecta sozinho —
 * o que falta é o usuário saber que os números na tela congelaram.
 */
export function useStream() {
  const [snapshot, setSnapshot] = useState(null);
  const [status, setStatus] = useState('connecting');
  const lastRef = useRef(0);

  useEffect(() => {
    const source = new EventSource('/api/stream');

    source.onmessage = (event) => {
      try {
        setSnapshot(JSON.parse(event.data));
        lastRef.current = Date.now();
        setStatus('live');
      } catch {
        // frame truncado: o próximo tick corrige
      }
    };
    source.onopen = () => setStatus('live');
    source.onerror = () => setStatus('reconnecting');

    // Conexão aberta mas sem dados também é falha — o EventSource não avisa.
    const watchdog = setInterval(() => {
      if (lastRef.current && Date.now() - lastRef.current > 12000) setStatus('stale');
    }, 4000);

    return () => {
      clearInterval(watchdog);
      source.close();
    };
  }, []);

  return { snapshot, status };
}

/** Histórico é sob demanda: só a página de GPUs pede, e só a faixa visível. */
export function useHistory(range, enabled = true) {
  const [series, setSeries] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;

    const load = async () => {
      try {
        const res = await fetch(`/api/history?range=${encodeURIComponent(range)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (alive) {
          setSeries(data.series ?? {});
          setLoading(false);
        }
      } catch {
        if (alive) setLoading(false);
      }
    };

    load();
    const timer = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [range, enabled]);

  return { series, loading };
}
