import { useState } from 'react';
import { signIn } from '../hooks/useAuth';
import Logo from '../components/Logo';
import { BRAND } from '../lib/constants';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    const { error } = await signIn(email.trim(), password);
    setBusy(false);
    if (error) {
      setError('Invalid credentials. Contact your 808 administrator if you need help.');
    }
  }

  return (
    <div className="min-h-screen grid place-items-center p-6">
      <div className="w-full max-w-md">
        <div className="panel relative overflow-hidden p-10" style={{ boxShadow: '0 30px 60px -20px rgba(35,35,35,0.25)' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'linear-gradient(90deg, var(--ink), var(--crimson), var(--ink))' }} />

          {/* Full logo lockup centered above the form */}
          <div className="flex flex-col items-center mb-6">
            <Logo variant="full" size={60} />
            <div className="font-display italic text-sm text-slate808 mt-3">Time Tracker & Operations</div>
          </div>

          <h1 className="font-display text-3xl font-semibold text-ink text-center">Welcome back</h1>
          <p className="text-slate808 text-sm mt-2 mb-6 leading-relaxed text-center">Sign in with your 808-issued credentials.</p>

          <form onSubmit={handleSubmit}>
            <div className="mb-4">
              <label className="field-label">Email</label>
              <input
                className="input"
                type="email"
                placeholder="you@example.com"
                autoComplete="username"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="mb-4">
              <label className="field-label">Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  className="input"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Your password"
                  autoComplete="current-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  style={{ paddingRight: 60 }}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  style={{
                    position: 'absolute',
                    right: 8,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--slate)',
                    fontFamily: 'Bebas Neue, Impact, sans-serif',
                    fontSize: 11,
                    letterSpacing: '0.16em',
                    cursor: 'pointer',
                    padding: '4px 8px'
                  }}
                  onMouseEnter={e => { e.currentTarget.style.color = 'var(--crimson)'; }}
                  onMouseLeave={e => { e.currentTarget.style.color = 'var(--slate)'; }}
                >
                  {showPassword ? 'HIDE' : 'SHOW'}
                </button>
              </div>
            </div>

            {error && (
              <div className="text-sm text-crimson bg-crimson/5 border border-crimson/20 rounded px-3 py-2 mb-4">
                {error}
              </div>
            )}

            <button type="submit" disabled={busy} className="btn-ink w-full py-3">
              {busy ? 'SIGNING IN…' : 'SIGN IN'}
            </button>
          </form>

          <div className="mt-5 pt-4 border-t border-line-soft text-xs text-muted leading-relaxed">
            This system is confidential and proprietary to {BRAND.companyName}. Unauthorized access is prohibited and monitored. All activity is logged.
          </div>
          <div className="mt-3 text-xs text-muted text-center">
            Forgot your password? Contact <a href={`mailto:${BRAND.email}`} className="text-crimson hover:underline">{BRAND.email}</a> or call {BRAND.phone}.
          </div>
        </div>

        <div className="text-center mt-6 text-xs text-muted">
          © 2026 {BRAND.companyName}. A brand of {BRAND.parentCompany}. All rights reserved.
        </div>
      </div>
    </div>
  );
}
