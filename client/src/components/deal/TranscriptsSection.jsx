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

// Meeting transcripts (e.g. Google Gemini call recordings, exported as text)
// uploaded from the Meetings collapsible. Same deal_attachments table/bucket
// as AttachmentsSection, tagged kind: 'transcript' (see 0042) so the two
// lists never mix. v1 is upload/list/download/delete only — a v2 AI-analysis
// pass over transcript content is a separate future feature, not built here.
export default function TranscriptsSection({ dealId }) {
  const [transcripts, setTranscripts] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef(null);
  const { user } = useAuth();
  const uploadedBy = ownerFromEmail(user?.email);

  const load = useCallback(() => {
    api.listTranscripts(dealId).then(setTranscripts).catch(() => setTranscripts([]));
  }, [dealId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleFiles(files) {
    if (!files || !files.length) return;
    setBusy(true);
    try {
      for (const file of files) {
        await api.uploadTranscript(dealId, file, uploadedBy);
      }
      load();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function download(transcript) {
    try {
      const url = await api.getAttachmentDownloadUrl(transcript);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      alert(e.message);
    }
  }

  async function remove(transcript) {
    setBusy(true);
    try {
      await api.deleteAttachment(dealId, transcript.id);
      load();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (transcripts === null) return null;

  return (
    <section>
      <Eyebrow className="mb-3">Meeting Transcripts</Eyebrow>

      {transcripts.length === 0 ? (
        <div className="text-text-disabled text-[12px] mb-3">No transcripts uploaded yet.</div>
      ) : (
        <div className="space-y-2 mb-3">
          {transcripts.map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-2 border-b border-hairline pb-2">
              <div className="flex items-center gap-2 min-w-0">
                <IconButton icon="paperclip" className="pointer-events-none h-6 w-6 shrink-0" />
                <button
                  onClick={() => download(t)}
                  className="text-[13px] text-text-primary hover:text-signal truncate text-left"
                >
                  {t.filename}
                </button>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[11px] text-text-muted">{formatFileSize(t.file_size)}</span>
                <span className="text-[11px] text-text-muted">{t.uploaded_by ?? '—'}</span>
                <span className="text-[11px] text-text-muted">{fmtDate(t.created_at)}</span>
                <Button variant="ghost" disabled={busy} onClick={() => remove(t)}>Remove</Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Button variant="secondary" disabled={busy} onClick={() => fileInputRef.current?.click()}>
        + Upload
      </Button>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        accept=".txt,.md,text/plain,text/csv,.pdf,.doc,.docx"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </section>
  );
}
