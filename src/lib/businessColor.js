// Generates a consistent color for a business based on its ID.
// Same business ID always gets the same color across the app.

const PALETTE = [
  { name: 'crimson', hex: '#a80404', light: '#fde8e8', ring: 'rgba(168,4,4,0.25)' },
  { name: 'navy',    hex: '#1e3a5f', light: '#e5ecf4', ring: 'rgba(30,58,95,0.25)' },
  { name: 'forest',  hex: '#2d6a4f', light: '#e3f2ea', ring: 'rgba(45,106,79,0.25)' },
  { name: 'plum',    hex: '#5b2c4e', light: '#f2e5ed', ring: 'rgba(91,44,78,0.25)' },
  { name: 'burnt',   hex: '#b35c1e', light: '#fce8d9', ring: 'rgba(179,92,30,0.25)' },
  { name: 'teal',    hex: '#1d6e72', light: '#dbeef0', ring: 'rgba(29,110,114,0.25)' },
  { name: 'slate',   hex: '#4d4e4f', light: '#e8e8e9', ring: 'rgba(77,78,79,0.25)' },
  { name: 'olive',   hex: '#6b6326', light: '#eeead8', ring: 'rgba(107,99,38,0.25)' },
  { name: 'wine',    hex: '#7d0f3a', light: '#f7dde5', ring: 'rgba(125,15,58,0.25)' },
  { name: 'indigo',  hex: '#3b3d8f', light: '#e3e3f2', ring: 'rgba(59,61,143,0.25)' }
];

// Simple hash of the business ID to pick a color index deterministically
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function getBusinessColor(businessId) {
  if (!businessId) return PALETTE[0];
  const idx = hashString(businessId) % PALETTE.length;
  return PALETTE[idx];
}

export function businessDot(businessId) {
  const c = getBusinessColor(businessId);
  return { display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: c.hex, flexShrink: 0 };
}
