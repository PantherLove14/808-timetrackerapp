// 808 Talent Source brand logo. Renders the real PNG asset.
// Both variants are transparent PNGs designed for light backgrounds, so they
// sit naturally on the app's cream/paper surfaces — no dark plate needed.
//
// Variants:
//   variant="mark"  → square 808-only mark (favicon, tight UI spots)
//   variant="full"  → full lockup with TALENT SOURCE wordmark + tagline
//                     (login page, header, branded surfaces)
export default function Logo({ variant = 'mark', size = 38, className = '' }) {
  const src = variant === 'full' ? '/brand/808-logo-full.png' : '/brand/808-logo-mark.png';
  // Full lockup native ratio is ~459:132 → about 3.48:1
  const aspectStyle = variant === 'full'
    ? { width: size * 3.48, height: size }
    : { width: size, height: size };

  return (
    <img
      src={src}
      alt="808 Talent Source"
      className={className}
      style={{
        ...aspectStyle,
        objectFit: 'contain',
        display: 'block',
        flexShrink: 0
      }}
    />
  );
}
