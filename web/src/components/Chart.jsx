import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NA, clockTime } from '../lib/format.js';

const PAD = { top: 12, right: 10, bottom: 18, left: 42 };

/** Mede a largura real do container: escalar o SVG por CSS distorceria o traço. */
function useWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    if (!ref.current) return undefined;
    const el = ref.current;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width;
      if (w) setWidth(Math.round(w));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}

/**
 * Gráfico de linha em SVG puro.
 *
 * `points`: [{ t, v }] com v podendo ser null. Buraco no dado vira buraco na
 * linha — interpolar por cima esconderia justamente o momento em que a coleta
 * falhou, que é quando o gráfico mais importa.
 */
export default function Chart({
  title,
  points = [],
  unit = '',
  color = 'var(--blue)',
  height = 150,
  domainMax = null,
  domainMin = 0,
  decimals = 0,
  id,
}) {
  const [ref, width] = useWidth();
  const gradientId = `grad-${id}`;

  const values = points.map((p) => p.v).filter((v) => v != null);
  const hasData = values.length > 0;

  const rawMax = hasData ? Math.max(...values) : 1;
  const rawMin = hasData ? Math.min(...values) : 0;
  // Domínio fixo (0–100%) quando faz sentido; senão, folga de 15% no topo para
  // a linha não encostar na borda.
  const max = domainMax ?? Math.max(rawMax * 1.15, rawMax + 1);
  const min = domainMin ?? Math.min(rawMin, 0);

  const innerW = Math.max(0, width - PAD.left - PAD.right);
  const innerH = height - PAD.top - PAD.bottom;

  const last = points.length ? points[points.length - 1].v : null;

  const xAt = (i) => PAD.left + (points.length > 1 ? (i / (points.length - 1)) * innerW : innerW / 2);
  const yAt = (v) => PAD.top + innerH - ((v - min) / (max - min || 1)) * innerH;

  // Segmentos separados por lacuna de dados.
  const segments = [];
  let current = [];
  points.forEach((p, i) => {
    if (p.v == null) {
      if (current.length) segments.push(current);
      current = [];
      return;
    }
    current.push([xAt(i), yAt(p.v)]);
  });
  if (current.length) segments.push(current);

  const linePath = segments
    .map((seg) => seg.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' '))
    .join(' ');

  const areaPath = segments
    .filter((seg) => seg.length > 1)
    .map((seg) => {
      const base = PAD.top + innerH;
      const head = seg.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
      return `${head} L${seg[seg.length - 1][0].toFixed(1)},${base} L${seg[0][0].toFixed(1)},${base} Z`;
    })
    .join(' ');

  const ticks = [max, min + (max - min) / 2, min];

  return (
    <div ref={ref}>
      <div className="chart-head">
        <span className="chart-title">{title}</span>
        <span className={`chart-last ${last == null ? 'na' : ''}`} style={last == null ? undefined : { color }}>
          {last == null ? NA : `${last.toFixed(decimals)}${unit}`}
        </span>
      </div>

      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={title}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.22" />
              <stop offset="100%" stopColor={color} stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {ticks.map((t, i) => {
            const y = yAt(t);
            return (
              <g key={i}>
                <line
                  x1={PAD.left} x2={width - PAD.right} y1={y} y2={y}
                  stroke="var(--border-soft)" strokeWidth="1"
                />
                <text x={PAD.left - 8} y={y + 3} textAnchor="end" className="chart-axis">
                  {t.toFixed(decimals)}
                </text>
              </g>
            );
          })}

          {hasData ? (
            <>
              <path d={areaPath} fill={`url(#${gradientId})`} />
              <path
                d={linePath}
                fill="none"
                stroke={color}
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {points.length > 0 && last != null && (
                <circle cx={xAt(points.length - 1)} cy={yAt(last)} r="3" fill={color} />
              )}
              <text x={PAD.left} y={height - 4} className="chart-axis">
                {clockTime(points[0].t)}
              </text>
              <text x={width - PAD.right} y={height - 4} textAnchor="end" className="chart-axis">
                {clockTime(points[points.length - 1].t)}
              </text>
            </>
          ) : (
            <text x={width / 2} y={height / 2} textAnchor="middle" className="chart-axis">
              coletando dados…
            </text>
          )}
        </svg>
      )}
    </div>
  );
}

/** Linha minúscula, sem eixos, para os cartões do painel principal. */
export function Spark({ points = [], color = 'var(--blue)', height = 34, domainMax = 100 }) {
  const [ref, width] = useWidth();
  const values = points.map((p) => p.v).filter((v) => v != null);
  const max = domainMax ?? (values.length ? Math.max(...values) * 1.15 : 1);

  const path = points
    .map((p, i) => {
      if (p.v == null) return null;
      const x = points.length > 1 ? (i / (points.length - 1)) * width : width / 2;
      const y = height - (p.v / (max || 1)) * height;
      return `${x.toFixed(1)},${Math.max(1, Math.min(height - 1, y)).toFixed(1)}`;
    })
    .filter(Boolean);

  return (
    <div ref={ref} style={{ height, marginTop: 8 }}>
      {width > 0 && path.length > 1 && (
        <svg width={width} height={height} aria-hidden="true">
          <polyline
            points={path.join(' ')}
            fill="none"
            stroke={color}
            strokeWidth="1.75"
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity="0.9"
          />
        </svg>
      )}
    </div>
  );
}

/** Buffer curto no cliente só para as sparklines do painel principal. */
export function useTrail(value, limit = 60) {
  const [trail, setTrail] = useState([]);
  useEffect(() => {
    if (value == null) return;
    setTrail((prev) => [...prev.slice(-(limit - 1)), { t: Date.now(), v: value }]);
  }, [value, limit]);
  return trail;
}
