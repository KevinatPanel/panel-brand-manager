import { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '../../lib/api.js';
import { ownerFromEmail } from '../../lib/stages.js';
import { useAuth } from '../../state/AuthContext.jsx';
import { Eyebrow, Button, IconButton } from '../ui.jsx';
import { fmtDate } from '../../lib/dates.js';

function formatFileSize(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Supabase Storage (private 'deal-attachments' bucket, 25MB cap + mime
// allowlist enforced server-side, see 0023) is the first file-upload feature
// in this app — there's no prior pattern to follow.
export default function AttachmentsSection({ dealId }) {
  const [attachments, setAttachments] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef(null);
  const { user } = useAuth();
  // Whoever is actually clicking Upload IS the uploader — derived from the
  // signed-in session, not picked, same reasoning as Notes' author.
  const uploadedBy = ownerFromEmail(user?.email);

  const load = useCallback(() => {
    api.listAttachments(dealId).then(setAttachments).catch(() => setAttachments([]));
  }, [dealId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleFiles(files) {
    if (!files || !files.length) return;
    setBusy(true);
    try {
      for (const file of files) {
        await api.uploadAttachment(dealId, file, uploadedBy);
      }
      load();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function download(attachment) {
    try {
      const url = await api.getAttachmentDownloadUrl(attachment);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      alert(e.message);
    }
  }

  async function remove(attachment) {
    setBusy(true);
    try {
      await api.deleteAttachment(dealId, attachment.id);
      load();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (attachments === null) return null;

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <Eyebrow>Attachments</Eyebrow>
        <div className="flex items-center gap-2">
          <Button variant="ghost" disabled={busy} onClick={() => fileInputRef.current?.click()}>
            + Upload
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              handleFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      {attachments.length === 0 ? (
        <div className="text-text-disabled text-[12px]">No attachments yet.</div>
      ) : (
        <div className="space-y-2">
          {attachments.map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-2 border-b border-hairline pb-2">
              <div className="flex items-center gap-2 min-w-0">
                <IconButton icon="paperclip" className="pointer-events-none h-6 w-6 shrink-0" />
                <button
                  onClick={() => download(a)}
                  className="text-[13px] text-text-primary hover:text-signal truncate text-left"
                >
                  {a.filename}
                </button>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[11px] text-text-muted">{formatFileSize(a.file_size)}</span>
                <span className="text-[11px] text-text-muted">{a.uploaded_by ?? '—'}</span>
                <span className="text-[11px] text-text-muted">{fmtDate(a.created_at)}</span>
                <Button variant="ghost" disabled={busy} onClick={() => remove(a)}>Remove</Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
