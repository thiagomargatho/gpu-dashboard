import { NA, levelColor } from '../lib/format.js';

export function Card({ title, subtitle, right, children, className = '', ...rest }) {
  return (
    <section className={`card ${className}`} {...rest}>
      {(title || right) && (
        <header className="card-head">
          <div>
            <div className="card-title">{title}</div>
            {subtitle && <div className="card-sub">{subtitle}</div>}
          </div>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

/** Número grande. `value` já vem formatado — nunca formatamos dentro do componente. */
export function Metric({ label, value, unit, hint, size = 'lg', color }) {
  const missing = value === NA || value == null;
  return (
    <div>
      <div className="metric-label">{label}</div>
      <div
        className={`metric-value ${size === 'sm' ? 'sm' : ''} ${missing ? 'na' : ''}`}
        style={color && !missing ? { color } : undefined}
      >
        {missing ? NA : value}
        {unit && !missing && <span className="metric-unit">{unit}</span>}
      </div>
      {hint && <div className="metric-hint">{hint}</div>}
    </div>
  );
}

export function Bar({ percent, level = 'ok' }) {
  const width = typeof percent === 'number' && Number.isFinite(percent)
    ? Math.max(0, Math.min(100, percent)) : 0;
  return (
    <div className="bar">
      <i style={{ width: `${width}%`, background: levelColor(level) }} />
    </div>
  );
}

/** Barra composta: mostra quem está ocupando a VRAM, não só quanto. */
export function StackBar({ segments, total }) {
  return (
    <div className="bar-stack">
      {segments.map((s) => (
        <i
          key={s.label}
          style={{
            width: total ? `${Math.max(0, (s.value / total) * 100)}%` : 0,
            background: s.color,
          }}
          title={`${s.label}: ${s.text}`}
        />
      ))}
    </div>
  );
}

export function Legend({ items }) {
  return (
    <div className="legend">
      {items.map((it) => (
        <span key={it.label}>
          <b style={{ background: it.color }} />
          {it.label} <strong style={{ fontWeight: 500 }}>{it.text}</strong>
        </span>
      ))}
    </div>
  );
}

export function Chip({ level = 'info', children }) {
  const cls = { ok: 'chip-ok', warn: 'chip-warn', bad: 'chip-bad', info: 'chip-info' }[level] ?? '';
  return <span className={`chip ${cls}`}>{children}</span>;
}

export function Dot({ level = 'idle' }) {
  const cls = { ok: 'dot-ok', warn: 'dot-warn', bad: 'dot-bad', idle: 'dot-idle' }[level] ?? 'dot-idle';
  return <i className={`dot ${cls}`} />;
}

export function Alerts({ alerts }) {
  if (!alerts?.length) return null;
  return (
    <div>
      {alerts.map((a) => (
        <div key={a.id} className={`alert alert-${a.level}`}>
          <Dot level={a.level === 'critical' ? 'bad' : 'warn'} />
          <div>
            <b>{a.scope}</b> · {a.message}
          </div>
        </div>
      ))}
    </div>
  );
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}

export function KeyValues({ rows }) {
  return (
    <dl className="kv">
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd className={v === NA ? 'na' : undefined}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
