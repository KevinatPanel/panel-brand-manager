import { useState, useRef, useEffect } from 'react';
import { Eyebrow } from './ui.jsx';

// Secondary sidebar for the Companies board: a jump list of verticals (with
// counts), each expandable to reveal its companies. Clicking a vertical name
// scrolls the board to that section; clicking a company also opens its detail
// panel. Styled to match the primary SideNav.
export default function CompaniesNav({
  groups,
  onJumpVertical,
  onSelectCompany,
  onDropLead,
  onCreateVertical,
  onRenameVertical,
  onDeleteVertical,
  onReorderVertical,
}) {
  // Which verticals are expanded *within the nav* — independent of the board's
  // own open/closed state.
  const [expanded, setExpanded] = useState(() => new Set());
  // Which drop target is currently hovered during a drag, and what's being
  // dragged ('lead' = assign a company, 'vertical' = reorder).
  const [overId, setOverId] = useState(null);
  const [dragKind, setDragKind] = useState(null);
  // The vertical id currently being dragged to reorder (dims the source row).
  const [draggingVerticalId, setDraggingVerticalId] = useState(null);
  // Inline "new vertical" draft: clicking the button opens a focused text input;
  // committing a non-empty name creates the vertical (then drag companies in).
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState('');
  const draftRef = useRef(null);
  // Inline rename: the vertical id being edited + its working name.
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const editRef = useRef(null);
  // Inline delete confirmation: the vertical id awaiting "Delete?" confirmation
  // (only used when the vertical still has companies).
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  useEffect(() => {
    if (creating) draftRef.current?.focus();
  }, [creating]);

  useEffect(() => {
    if (editingId != null) editRef.current?.select();
  }, [editingId]);

  const commitDraft = () => {
    const name = draftName.trim();
    setCreating(false);
    setDraftName('');
    if (name) onCreateVertical?.(name);
  };
  const cancelDraft = () => {
    setCreating(false);
    setDraftName('');
  };

  const startRename = (g) => {
    setConfirmDeleteId(null);
    setEditName(g.name);
    setEditingId(g.id);
  };
  const commitRename = (g) => {
    const name = editName.trim();
    setEditingId(null);
    if (name && name !== g.name) onRenameVertical?.(g.id, name);
  };
  const cancelRename = () => setEditingId(null);

  const handleDeleteClick = (g) => {
    if (g.leads.length === 0) onDeleteVertical?.(g.id);
    else setConfirmDeleteId(g.id);
  };

  const toggle = (id) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const clearDrag = () => {
    setOverId(null);
    setDragKind(null);
    setDraggingVerticalId(null);
  };

  // Native HTML5 drag-and-drop drop-target props. A row accepts two payloads:
  // 'text/vertical' (reorder this list) and 'text/lead' (assign a company). The
  // payload type is only readable in onDrop, but its presence shows in
  // dataTransfer.types during onDragOver — used to pick the right highlight.
  const dropProps = (g) => ({
    onDragOver: (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const kind = e.dataTransfer.types.includes('text/vertical')
        ? 'vertical'
        : e.dataTransfer.types.includes('text/lead')
          ? 'lead'
          : null;
      setDragKind(kind);
      setOverId(g.id);
    },
    onDragLeave: () => setOverId((o) => (o === g.id ? null : o)),
    onDrop: (e) => {
      e.preventDefault();
      const verticalId = e.dataTransfer.getData('text/vertical');
      if (verticalId) {
        clearDrag();
        onReorderVertical?.(verticalId, g.id);
        return;
      }
      const leadId = e.dataTransfer.getData('text/lead');
      clearDrag();
      if (leadId) onDropLead?.(leadId, g.id === 'none' ? null : g.id);
    },
  });

  return (
    <aside className="shrink-0 sticky top-16 h-[calc(100vh-4rem)] w-56 bg-space border-r border-hairline flex flex-col">
      {/* Label sits inside the sidebar — the full-width top bar is above us. */}
      <div className="px-5 pt-4 pb-2">
        <Eyebrow className="text-text-muted">Verticals</Eyebrow>
      </div>

      <nav className="flex-1 overflow-y-auto pb-2">
        {groups.map((g) => {
          const isOpen = expanded.has(g.id);
          const isReal = g.id !== 'none'; // "Unsorted" is synthetic — no rename/delete
          const isEditing = editingId === g.id;
          return (
            <div key={g.id}>
              <div
                {...dropProps(g)}
                draggable={isReal && !isEditing}
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/vertical', String(g.id));
                  e.dataTransfer.effectAllowed = 'move';
                  setDraggingVerticalId(g.id);
                }}
                onDragEnd={clearDrag}
                className={`group relative flex items-center h-8 pr-3 text-[13px] text-text-secondary hover:text-text-primary transition-colors ${
                  isReal && !isEditing ? 'cursor-grab active:cursor-grabbing' : ''
                } ${draggingVerticalId === g.id ? 'opacity-50' : ''} ${
                  overId === g.id
                    ? dragKind === 'vertical'
                      ? 'border-t-2 border-signal'
                      : 'bg-card-hover ring-1 ring-inset ring-signal'
                    : ''
                }`}
              >
                <button
                  onClick={() => toggle(g.id)}
                  title={isOpen ? 'Collapse' : 'Expand'}
                  className="w-7 h-full flex items-center justify-center text-text-muted hover:text-text-primary shrink-0"
                >
                  {g.leads.length > 0 ? (isOpen ? '▾' : '▸') : ''}
                </button>

                {isEditing ? (
                  <input
                    ref={editRef}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onBlur={() => commitRename(g)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename(g);
                      else if (e.key === 'Escape') cancelRename();
                    }}
                    className="flex-1 min-w-0 h-6 bg-card text-text-primary text-[13px] px-1.5 outline-none border-l-2 border-signal"
                  />
                ) : (
                  <button
                    onClick={() => onJumpVertical(g.id)}
                    className="flex-1 min-w-0 flex items-center justify-between text-left hover:text-text-primary"
                  >
                    <span className="truncate">{g.name}</span>
                    <span
                      className={`ml-2 font-mono text-text-muted text-[12px] tabular-nums shrink-0 ${
                        isReal ? 'group-hover:hidden' : ''
                      }`}
                    >
                      {g.leads.length}
                    </span>
                  </button>
                )}

                {isReal && !isEditing && (
                  <div className="hidden group-hover:flex items-center gap-1.5 ml-2 shrink-0">
                    <button
                      onClick={() => startRename(g)}
                      title="Rename vertical"
                      className="text-text-muted hover:text-text-primary text-[12px]"
                    >
                      ✎
                    </button>
                    <button
                      onClick={() => handleDeleteClick(g)}
                      title="Delete vertical"
                      className="text-text-muted hover:text-red-400 text-[12px]"
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>

              {confirmDeleteId === g.id && (
                <div className="flex items-center justify-between gap-2 pl-7 pr-3 py-1.5 bg-card border-l-2 border-red-500/50">
                  <span className="text-text-secondary text-[12px] min-w-0 truncate">
                    Delete “{g.name}”? {g.leads.length} → Unsorted
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => {
                        onDeleteVertical?.(g.id);
                        setConfirmDeleteId(null);
                      }}
                      className="text-red-400 hover:text-red-300 text-[12px]"
                    >
                      Delete
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="text-text-muted hover:text-text-primary text-[12px]"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {isOpen && g.leads.length > 0 && (
                <div className="pb-1">
                  {g.leads.map((lead) => (
                    <button
                      key={lead.id}
                      onClick={() => onSelectCompany(lead.id, g.id)}
                      className="w-full flex items-center h-7 pl-9 pr-3 text-[12px] text-text-muted hover:text-text-primary transition-colors text-left"
                    >
                      <span className="truncate">{lead.company_name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Create a new vertical — click to reveal an inline, focused name field.
          On commit the vertical is created and becomes a normal drop target. */}
      <div className="shrink-0 border-t border-hairline">
        {creating ? (
          <input
            ref={draftRef}
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commitDraft}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitDraft();
              else if (e.key === 'Escape') cancelDraft();
            }}
            placeholder="Vertical name…"
            className="w-full h-9 px-5 bg-card text-text-primary text-[13px] outline-none border-l-2 border-signal placeholder:text-text-disabled"
          />
        ) : (
          <button
            onClick={() => setCreating(true)}
            className="w-full flex items-center h-9 px-5 text-[13px] text-text-muted hover:text-text-primary transition-colors text-left"
          >
            + New vertical
          </button>
        )}
      </div>
    </aside>
  );
}
