export default function PageHeader({ kicker, title, subtitle, right }) {
  return (
    <div className="flex justify-between items-end mb-8 flex-wrap gap-4">
      <div>
        {kicker && <div className="kicker mb-2">{kicker}</div>}
        <h1 className="font-display text-4xl font-bold text-ink leading-none">{title}</h1>
        {subtitle && <p className="text-slate808 text-sm mt-2 max-w-xl leading-relaxed">{subtitle}</p>}
      </div>
      {right && <div>{right}</div>}
    </div>
  );
}

export function SectionTitle({ children, kicker }) {
  return (
    <div className="mb-5">
      <div className="flex items-center">
        <h2 className="font-display text-xl font-semibold text-ink">{children}</h2>
        <div className="section-line flex-1"></div>
      </div>
      {kicker && <div className="kicker mt-1">{kicker}</div>}
    </div>
  );
}

export function StatCard({ kicker, value, sub, accent }) {
  return (
    <div className={`panel ${accent ? 'border-l-[3px] border-l-crimson' : ''}`}>
      <div className="kicker mb-2">{kicker}</div>
      <div className="font-display font-bold text-ink" style={{ fontSize: 32, lineHeight: 1 }}>{value}</div>
      {sub && <div className="text-muted text-xs mt-2">{sub}</div>}
    </div>
  );
}

export function Empty({ children }) {
  return (
    <div className="text-center py-12 px-4 text-muted font-display italic">
      {children || 'Nothing here yet.'}
    </div>
  );
}
