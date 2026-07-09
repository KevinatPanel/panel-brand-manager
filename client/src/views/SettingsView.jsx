import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import ViewHeader from '../components/ViewHeader.jsx';
import { Eyebrow, Button } from '../components/ui.jsx';
import GmailConnectionCard from '../components/GmailConnectionCard.jsx';
import { useAuth } from '../state/AuthContext.jsx';
import { initialsFromEmail } from '../lib/account.js';

export default function SettingsView() {
  const { user, signOut } = useAuth();
  const [params, setParams] = useSearchParams();
  const [banner, setBanner] = useState(null);

  // Surface the result of the OAuth round-trip — the callback redirects here
  // with ?connected=1 (or ?connected=0&error=...). Then clear the query params.
  useEffect(() => {
    if (params.get('connected') === '1') {
      setBanner({ kind: 'ok', text: 'Gmail connected.' });
    } else if (params.get('connected') === '0') {
      setBanner({ kind: 'err', text: `Gmail connection failed: ${params.get('error') || 'unknown error'}` });
    }
    if (params.has('connected')) {
      params.delete('connected');
      params.delete('error');
      setParams(params, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <ViewHeader title="Settings" subtitle="Account and connected tools" />
      <div className="p-6 max-w-2xl space-y-6">
        {banner && (
          <div
            className={`px-4 py-2.5 text-[13px] border ${
              banner.kind === 'ok'
                ? 'border-signal/40 text-signal'
                : 'border-red-500/40 text-red-400'
            }`}
          >
            {banner.text}
          </div>
        )}

        {/* Account */}
        <div className="panel-card p-5">
          <Eyebrow className="mb-4">Account</Eyebrow>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 shrink-0 flex items-center justify-center bg-card-hover border border-hairline text-text-primary text-[13px] font-medium">
                {initialsFromEmail(user?.email)}
              </div>
              <div className="text-text-primary text-[13px]">{user?.email}</div>
            </div>
            <Button variant="ghost" onClick={signOut}>
              Sign out
            </Button>
          </div>
        </div>

        {/* Integrations */}
        <div>
          <Eyebrow className="mb-3">Integrations</Eyebrow>
          <GmailConnectionCard />
        </div>
      </div>
    </>
  );
}
