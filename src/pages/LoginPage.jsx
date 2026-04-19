import { useState } from 'react';
import { signIn } from '../hooks/useAuth';
import Logo from '../components/Logo';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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

          <div className="flex items-center gap-3 mb-6">
            <Logo className="w-14 h-14" />
            <div>
              <div className="font-bebas text-2xl tracking-widest text-ink leading-none">808 TALENT SOURCE</div>
              <div className="font-display italic text-sm text-slate808 mt-1">Time Tracker & Operations</div>
            </div>
          </div>

          <h1 className="font-display text-3xl font-semibold text-ink">Welcome back</h1>
          <p className="text-slate808 text-sm mt-2 mb-6 leading-relaxed">Sign in with your 808-issued credentials.</p>

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
              <input
                className="input"
                type="password"
                placeholder="Your password"
                autoComplete="current-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
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
            This system is confidential and proprietary to 808 Talent Source, LLC. Unauthorized access is prohibited and monitored. All activity is logged.
          </div>
          <div className="mt-3 text-xs text-muted text-center">
            Forgot your password? Contact your 808 administrator.
          </div>
        </div>

        <div className="text-center mt-6 text-xs text-muted">
          © 2026 808 Talent Source, LLC. A brand of Impctrs Management Group. All rights reserved.
        </div>
      </div>
    </div>
  );
}
