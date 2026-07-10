import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { useEditor, EditorContent, ReactRenderer } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Mention from '@tiptap/extension-mention';
import { OWNERS, ownerFromEmail } from '../../lib/stages.js';
import { useAuth } from '../../state/AuthContext.jsx';
import { Button, Eyebrow } from '../ui.jsx';

// Shared extension list — used both by the live editor below and by
// NotesSection's read-only generateHTML() rendering of stored content_json,
// so mention nodes round-trip the same way in both places.
export const NOTE_EXTENSIONS = [
  StarterKit,
  Mention.configure({
    HTMLAttributes: { class: 'mention' },
    suggestion: mentionSuggestion(),
  }),
];

// @mentions resolve against the app's static OWNERS list (Tom/Raven/Andrew/
// Kevin) — there's no users table anywhere in this app, so this is a
// synchronous filter over a constant array, not an async lookup.
function mentionSuggestion() {
  return {
    items: ({ query }) =>
      OWNERS.filter((o) => o.toLowerCase().startsWith(query.toLowerCase())).slice(0, 5),
    render: () => {
      let component;
      let popup;

      const position = (clientRect) => {
        const rect = clientRect?.();
        if (!rect || !popup) return;
        popup.style.top = `${rect.bottom + 4}px`;
        popup.style.left = `${rect.left}px`;
      };

      return {
        onStart: (props) => {
          component = new ReactRenderer(MentionList, { props, editor: props.editor });
          popup = component.element;
          popup.style.position = 'fixed';
          popup.style.zIndex = '50';
          document.body.appendChild(popup);
          position(props.clientRect);
        },
        onUpdate(props) {
          component.updateProps(props);
          position(props.clientRect);
        },
        onKeyDown(props) {
          if (props.event.key === 'Escape') {
            component.destroy();
            popup?.remove();
            return true;
          }
          return component.ref?.onKeyDown(props) ?? false;
        },
        onExit() {
          popup?.remove();
          component.destroy();
        },
      };
    },
  };
}

const MentionList = forwardRef((props, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => setSelectedIndex(0), [props.items]);

  const selectItem = (index) => {
    const item = props.items[index];
    if (item) props.command({ id: item, label: item });
  };

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === 'ArrowUp') {
        setSelectedIndex((selectedIndex + props.items.length - 1) % props.items.length);
        return true;
      }
      if (event.key === 'ArrowDown') {
        setSelectedIndex((selectedIndex + 1) % props.items.length);
        return true;
      }
      if (event.key === 'Enter') {
        selectItem(selectedIndex);
        return true;
      }
      return false;
    },
  }));

  if (!props.items.length) return null;

  return (
    <div className="bg-space border border-hairline shadow-lg py-1 min-w-[140px]">
      {props.items.map((item, index) => (
        <button
          key={item}
          type="button"
          onClick={() => selectItem(index)}
          className={`block w-full text-left px-3 py-1.5 text-[13px] ${
            index === selectedIndex ? 'bg-card-hover text-text-primary' : 'text-text-secondary'
          }`}
        >
          {item}
        </button>
      ))}
    </div>
  );
});

function ToolbarButton({ active, onClick, children, title }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`w-7 h-7 text-[12px] border transition-colors ${
        active
          ? 'border-signal/50 text-signal'
          : 'border-hairline text-text-muted hover:text-text-primary hover:bg-card-hover'
      }`}
    >
      {children}
    </button>
  );
}

// Bold/italic/lists minimum + @mentions, per spec. Rich text is stored as
// Tiptap's document JSON (editor.getJSON()), not raw HTML — see 0022's
// migration comment for why.
export default function NoteEditor({ busy, onCancel, onSubmit }) {
  const editor = useEditor({ extensions: NOTE_EXTENSIONS });
  const { user } = useAuth();
  // The signed-in user IS the author — there's no legitimate case for
  // authoring a note "as" someone else, so this is derived, not picked.
  const author = ownerFromEmail(user?.email);

  if (!editor) return null;

  function submit() {
    const content_text = editor.getText();
    if (!content_text.trim()) return;
    onSubmit({ content_json: editor.getJSON(), content_text, author }).then(() => editor?.commands.clearContent());
  }

  return (
    <div className="border border-hairline p-3 space-y-2">
      <div className="flex items-center gap-1 border-b border-hairline pb-2">
        <Eyebrow className="mr-2 shrink-0">{author ?? 'Unknown'}</Eyebrow>
        <span className="w-px h-5 bg-hairline mr-1" />
        <ToolbarButton title="Bold" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
          B
        </ToolbarButton>
        <ToolbarButton title="Italic" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
          I
        </ToolbarButton>
        <ToolbarButton
          title="Bullet list"
          active={editor.isActive('bulletList')}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          •
        </ToolbarButton>
        <ToolbarButton
          title="Numbered list"
          active={editor.isActive('orderedList')}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          1.
        </ToolbarButton>
      </div>
      <EditorContent
        editor={editor}
        className="tiptap-content text-[13px] text-text-primary min-h-[72px] outline-none"
      />
      <div className="flex justify-end gap-2">
        {onCancel && <Button variant="ghost" onClick={onCancel}>Cancel</Button>}
        <Button variant="primary" disabled={busy} onClick={submit}>Post Note</Button>
      </div>
    </div>
  );
}
