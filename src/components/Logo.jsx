// Stylized 808 mark based on the uploaded logo aesthetic.
// Uses brand colors: crimson for outer 8s, slate for inner 8.
export default function Logo({ className = '', size = 60 }) {
  return (
    <svg
      className={className}
      viewBox="0 0 120 120"
      xmlns="http://www.w3.org/2000/svg"
      style={{ width: size, height: size }}
      role="img"
      aria-label="808 Talent Source"
    >
      <rect width="120" height="120" fill="#232323" rx="4" />
      {/* Left 8 — crimson */}
      <g stroke="#a80404" strokeWidth="3.5" fill="none" strokeLinecap="round">
        <ellipse cx="38" cy="40" rx="18" ry="16" />
        <ellipse cx="38" cy="78" rx="18" ry="16" />
      </g>
      {/* Center 8 — slate (behind) */}
      <g stroke="#6c6d6e" strokeWidth="3.5" fill="none" strokeLinecap="round">
        <ellipse cx="60" cy="40" rx="18" ry="16" />
        <ellipse cx="60" cy="78" rx="18" ry="16" />
      </g>
      {/* Right 8 — crimson */}
      <g stroke="#a80404" strokeWidth="3.5" fill="none" strokeLinecap="round">
        <ellipse cx="82" cy="40" rx="18" ry="16" />
        <ellipse cx="82" cy="78" rx="18" ry="16" />
      </g>
    </svg>
  );
}
