export default function Modal({ open, onClose, title, subtitle, children, footer }) {
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal animate-fadeIn" onClick={e => e.stopPropagation()}>
        {title && <h2 className="font-display text-2xl font-semibold text-ink">{title}</h2>}
        {subtitle && <p className="text-slate808 text-sm mt-1 mb-5 leading-relaxed">{subtitle}</p>}
        {children}
        {footer && <div className="flex gap-2 justify-end mt-6 flex-wrap">{footer}</div>}
      </div>
    </div>
  );
}
