// 808 Talent Source brand logo. Renders the real PNG asset on a dark plate
// because both lockup variants are designed for dark backgrounds.
//
// Variants:
//   variant="mark"     → square 808-only mark, ideal for tight spots (header)
//   variant="full"     → full lockup with TALENT SOURCE wordmark + tagline,
//                        ideal for login page and large branded surfaces
//
// Both use a fixed dark plate so the gold + white reads clearly against the
// app's cream/paper backgrounds without altering the brand asset itself.
export default function Logo({ variant = 'mark', size = 38, className = '', plate = true }) {
  const src = variant === 'full' ? '/brand/808-logo-full.png' : '/brand/808-logo-mark.png';
  const aspectStyle = variant === 'full'
    ? { width: size * 2.4, height: size }   // full lockup is wider
    : { width: size, height: size };

  if (!plate) {
    return (
      <img
        src={src}
        alt="808 Talent Source"
        className={className}
        style={{ ...aspectStyle, objectFit: 'contain', display: 'block' }}
      />
    );
  }

  return (
    <div
      className={className}
      style={{
        ...aspectStyle,
        background: 'var(--ink)',
        borderRadius: 4,
        padding: variant === 'full' ? `${size * 0.08}px ${size * 0.12}px` : `${size * 0.08}px`,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxSizing: 'border-box',
        flexShrink: 0
      }}
    >
      <img
        src={src}
        alt="808 Talent Source"
        style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
      />
    </div>
  );
}
