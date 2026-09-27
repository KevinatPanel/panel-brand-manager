import { useCallback, useEffect, useState } from 'react';
import { Button, Eyebrow, Input, TextArea } from '../ui.jsx';
import { playbook } from '../../lib/playbookApi.js';
import { fmtDateOnly, todayInput } from '../../lib/dates.js';
import { ownerFromEmail } from '../../lib/stages.js';
import { useAuth } from '../../state/AuthContext.jsx';

// Meta's public Ad Library, searched for this brand (Instagram + Facebook, US).
export function adLibraryUrl(name) {
  const q = encodeURIComponent((name || '').trim());
  return `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&media_type=all&search_type=keyword_unordered&q=${q}`;
}

const EMPTY = { checked_on: '', active_ads: '', hook: '', notes: '', creators: [{ handle: '', angle: '' }] };

// Ad Library check on the company profile: open the brand's live partnered
// ads, log who they pay and the angle each creator uses. The latest check
// feeds the qualifier ("already paying creators") and the call prep sheet.
export default function AdLibrarySection({ lead, onLatest }) {
  const { user } = useAuth();
  const [checks, setChecks] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    playbook
      .listAdChecks(lead.id)
      .then((rows) => {
        setChecks(rows);
        onLatest?.(rows[0] ?? null);
      })
      .catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id]);
  useEffect(() => {
    load();
  }, [load]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await playbook.addAdCheck(lead.id, {
        checked_on: form.checked_on || todayInput(),
        active_ads: form.active_ads === '' ? null : Number(form.active_ads),
        creators: form.creators.filter((c) => c.handle.trim()).map((c) => ({ handle: c.handle.trim().replace(/^@/, ''), angle: c.angle.trim() || null })),
        hook: form.hook,
        notes: form.notes,
        checked_by: ownerFromEmail(user?.email),
      });
      setForm(null);
      setError(null);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id) {
    try {
      await playbook.deleteAdCheck(id);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  const setCreator = (i, patch) =>
    setForm((f) => ({ ...f, creators: f.creators.map((c, j) => (j === i ? { ...c, ...patch } : c)) }));

  return (
    <section className="px-5 py-4 border-t border-hairline">
      <div className="flex items-center justify-between mb-3">
        <Eyebrow>Ad Library</Eyebrow>
        <div className="flex items-center gap-2">
          <a
            href={adLibraryUrl(lead.company_name)}
            target="_blank"
            rel="noreferrer"
            className="text-signal hover:underline text-[12px]"
          >
            Open in Meta Ad Library ↗
          </a>
          {!form && <Button variant="ghost" onClick={() => setForm({ ...EMPTY, creators: [{ handle: '', angle: '' }] })}>+ Log check</Button>}
        </div>
      </div>

      {form && (
        <form onSubmit={submit} className="border border-hairline p-3 mb-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="eyebrow text-text-muted block mb-1">Checked on</span>
              <Input type="date" value={form.checked_on || todayInput()} onChange={(e) => setForm({ ...form, checked_on: e.target.value })} />
            </label>
            <label className="block">
              <span className="eyebrow text-text-muted block mb-1">Partnered ads live</span>
              <Input type="number" min="0" value={form.active_ads} onChange={(e) => setForm({ ...form, active_ads: e.target.value })} placeholder="0" />
            </label>
          </div>
          <span className="eyebrow text-text-muted block">Creators they pay, and the angle</span>
          {form.creators.map((c, i) => (
            <div key={i} className="grid grid-cols-[1fr_2fr] gap-2">
              <Input value={c.handle} onChange={(e) => setCreator(i, { handle: e.target.value })} placeholder="@handle" />
              <Input value={c.angle} onChange={(e) => setCreator(i, { angle: e.target.value })} placeholder="Angle, e.g. paycheck-to-paycheck budgeting" />
            </div>
          ))}
          <button
            type="button"
            onClick={() => setForm((f) => ({ ...f, creators: [...f.creators, { handle: '', angle: '' }] }))}
            className="text-text-muted hover:text-text-primary text-[12px]"
          >
            + Another creator
          </button>
          <TextArea rows={2} value={form.hook} onChange={(e) => setForm({ ...form, hook: e.target.value })} placeholder="Outreach hook this suggests" />
          <TextArea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Notes" />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setForm(null)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={busy}>Save check</Button>
          </div>
        </form>
      )}

      {checks == null ? null : checks.length === 0 ? (
        <div className="text-text-disabled text-[12px]">Not checked yet. See who they pay and how they sell before the call.</div>
      ) : (
        <div className="space-y-3">
          {checks.map((c) => (
            <div key={c.id} className="border-b border-hairline pb-2">
              <div className="flex items-center justify-between">
                <span className="eyebrow text-text-muted">
                  {fmtDateOnly(c.checked_on)}{c.checked_by ? ` · ${c.checked_by}` : ''}
                  {c.active_ads != null ? ` · ${c.active_ads} ad${c.active_ads === 1 ? '' : 's'} live` : ''}
                </span>
                <button onClick={() => remove(c.id)} className="text-text-muted hover:text-red-400 text-[12px]" title="Delete check">✕</button>
              </div>
              {(c.creators ?? []).length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {c.creators.map((cr, i) => (
                    <li key={i} className="text-[12px] text-text-secondary">
                      <span className="text-text-primary">@{cr.handle}</span>{cr.angle ? ` · ${cr.angle}` : ''}
                    </li>
                  ))}
                </ul>
              )}
              {c.hook && <p className="mt-1 text-[12px] text-text-primary">Hook: {c.hook}</p>}
              {c.notes && <p className="mt-0.5 text-[12px] text-text-muted whitespace-pre-wrap">{c.notes}</p>}
            </div>
          ))}
        </div>
      )}
      {error && <div className="mt-2 text-red-400 text-[12px]">{error}</div>}
    </section>
  );
}
