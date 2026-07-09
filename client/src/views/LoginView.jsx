import { useState } from 'react';
import { useAuth } from '../state/AuthContext.jsx';
import { Input, Button, Eyebrow } from '../components/ui.jsx';

// Magic-link login. Generic success messaging so a non-allowlisted email can't
// learn whether it's on the team.
export default function LoginView() {
  const { signInWithEmail, devSignIn } = useAuth();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [code, setCode] = useState('');
  const [devBusy, setDevBusy] = useState(false);
  const [devError, setDevError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setError(null);
    const { error: err } = await signInWithEmail(email.trim());
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    setSent(true);
  }

  // Local-dev only: sign in with the numeric code (the dev account's password).
  async function devSubmit(e) {
    e.preventDefault();
    if (!code.trim()) return;
    setDevBusy(true);
    setDevError(null);
    const { error: err } = await devSignIn(code.trim());
    setDevBusy(false);
    if (err) setDevError('Invalid code');
    // On success, onAuthStateChange flips the session and App renders the app.
  }

  return (
    <div className="min-h-screen bg-space flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <div className="text-text-primary font-semibold tracking-tight text-[18px]">Panel</div>
          <Eyebrow className="text-text-muted mt-1">Sales Tracker</Eyebrow>
        </div>

        {sent ? (
          <div className="panel-card p-6">
            <div className="text-text-primary text-[14px] mb-1.5">Check your email</div>
            <p className="text-text-secondary text-[13px] leading-relaxed">
              If <span className="text-text-primary">{email}</span> is on the team, a one-time
              sign-in link is on its way. Open it on this device to continue.
            </p>
            <button
              onClick={() => setSent(false)}
              className="text-text-muted hover:text-text-primary text-[12px] mt-4"
            >
              ← Use a different email
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="panel-card p-6 space-y-4">
            <div>
              <Eyebrow className="mb-1.5">Email</Eyebrow>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@panel.com"
                autoFocus
              />
            </div>
            {error && <div className="text-red-400 text-[12px]">{error}</div>}
            <Button type="submit" variant="primary" className="w-full" disabled={busy}>
              {busy ? 'Sending…' : 'Send magic link →'}
            </Button>
            <p className="text-text-disabled text-[11px] leading-relaxed">
              Access is limited to the Panel team. You'll receive a one-time sign-in link by email —
              no password needed.
            </p>
          </form>
        )}

        {import.meta.env.DEV && (
          <form onSubmit={devSubmit} className="panel-card p-4 mt-4 space-y-3 border-dashed">
            <Eyebrow className="text-text-muted">Local dev only</Eyebrow>
            <Input
              type="password"
              inputMode="numeric"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Access code"
            />
            {devError && <div className="text-red-400 text-[12px]">{devError}</div>}
            <Button type="submit" variant="secondary" className="w-full" disabled={devBusy}>
              {devBusy ? 'Signing in…' : 'Dev sign in →'}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
