import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import ViewHeader from '../components/ViewHeader.jsx';
import { Eyebrow, Button, Field, Input } from '../components/ui.jsx';
import GmailConnectionCard from '../components/GmailConnectionCard.jsx';
import { useAuth } from '../state/AuthContext.jsx';
import { accountName, accountInitials } from '../lib/account.js';

export default function SettingsView() {
  const { user, signOut, updateProfile } = useAuth();
  const [params, setParams] = useSearchParams();
  const [banner, setBanner] = useState(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [savingName, setSavingName] = useState(false);

  // Sync the edit form to the auth user's stored metadata once it's loaded
  // (and whenever it changes, e.g. right after a save resolves).
  useEffect(() => {
    setFirstName(user?.user_metadata?.first_name ?? '');
    setLastName(user?.user_metadata?.last_name ?? '');
  }, [user?.user_metadata?.first_name, user?.user_metadata?.last_name]);

  async function saveName(e) {
    e.preventDefault();
    setSavingName(true);
    try {
      const { error } = await updateProfile({ firstName, lastName });
      if (error) throw error;
      setBanner({ kind: 'ok', text: 'Name updated.' });
    } catch (err) {
      setBanner({ kind: 'err', text: err.message });
    } finally {
      setSavingName(false);
    }
  }

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
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 shrink-0 flex items-center justify-center bg-card-hover border border-hairline text-text-primary text-[13px] font-medium">
                {accountInitials(user)}
              </div>
              <div>
                {accountName(user) && (
                  <div className="text-text-primary text-[13px] font-medium">{accountName(user)}</div>
                )}
                <div className="text-text-secondary text-[12px]">{user?.email}</div>
              </div>
            </div>
            <Button variant="ghost" onClick={signOut}>
              Sign out
            </Button>
          </div>

          <form onSubmit={saveName} className="border-t border-hairline pt-4">
            <div className="grid grid-cols-2 gap-3 mb-3">
              <Field label="First name">
                <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="First name" />
              </Field>
              <Field label="Last name">
                <Input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Last name" />
              </Field>
            </div>
            <div className="flex justify-end">
              <Button type="submit" variant="primary" disabled={savingName}>
                {savingName ? 'Saving…' : 'Save name'}
              </Button>
            </div>
          </form>
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
