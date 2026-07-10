import { useEffect, useState, useCallback } from 'react';
import { api } from '../../lib/api.js';
import { OWNERS, STAGES, STAGE_LABELS, isTaskOverdue } from '../../lib/stages.js';
import { Eyebrow, Input, Select, Button } from '../ui.jsx';
import { fmtDateOnly, todayInput } from '../../lib/dates.js';

export default function TasksSection({ dealId }) {
  const [tasks, setTasks] = useState(null);
  const [adding, setAdding] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.listTasks(dealId).then(setTasks).catch(() => setTasks([]));
  }, [dealId]);

  useEffect(() => {
    load();
  }, [load]);

  async function after(fn) {
    setBusy(true);
    try {
      await fn();
      load();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (tasks === null) return null;

  const open = tasks.filter((t) => t.status === 'open');
  const completed = tasks.filter((t) => t.status === 'done');

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <Eyebrow>Tasks</Eyebrow>
        <Button variant="ghost" onClick={() => setAdding((a) => !a)}>+ Add Task</Button>
      </div>

      {adding && (
        <TaskForm
          busy={busy}
          onCancel={() => setAdding(false)}
          onSubmit={(body) => after(() => api.addTask(dealId, body)).then(() => setAdding(false))}
        />
      )}

      {open.length === 0 && !adding ? (
        <div className="text-text-disabled text-[12px]">No open tasks.</div>
      ) : (
        <div className="space-y-2">
          {open.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              busy={busy}
              onComplete={() => after(() => api.completeTask(dealId, t.id))}
              onRemove={() => after(() => api.deleteTask(dealId, t.id))}
            />
          ))}
        </div>
      )}

      {completed.length > 0 && (
        <div className="mt-3">
          <button
            onClick={() => setShowCompleted((s) => !s)}
            className="eyebrow text-text-muted hover:text-text-primary"
          >
            {showCompleted ? '▾' : '▸'} Completed ({completed.length})
          </button>
          {showCompleted && (
            <div className="space-y-2 mt-2">
              {completed.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  busy={busy}
                  completed
                  onReopen={() => after(() => api.reopenTask(dealId, t.id))}
                  onRemove={() => after(() => api.deleteTask(dealId, t.id))}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function TaskForm({ busy, onCancel, onSubmit }) {
  const [form, setForm] = useState({ title: '', owner: '', due_date: todayInput(), stage_code: '' });
  return (
    <div className="border border-hairline p-3 mb-3 space-y-2">
      <Input
        value={form.title}
        onChange={(e) => setForm({ ...form, title: e.target.value })}
        placeholder="Task title"
        autoFocus
      />
      <div className="grid grid-cols-3 gap-2">
        <Select value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })}>
          <option value="">Unassigned</option>
          {OWNERS.map((o) => <option key={o} value={o}>{o}</option>)}
        </Select>
        <Input
          type="date"
          value={form.due_date}
          onChange={(e) => setForm({ ...form, due_date: e.target.value })}
          style={{ colorScheme: 'dark' }}
          className="font-mono"
        />
        <Select value={form.stage_code} onChange={(e) => setForm({ ...form, stage_code: e.target.value })}>
          <option value="">No linked stage</option>
          {STAGES.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
        </Select>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" disabled={busy || !form.title.trim()} onClick={() => onSubmit(form)}>
          Add Task
        </Button>
      </div>
    </div>
  );
}

function TaskRow({ task, busy, completed, onComplete, onReopen, onRemove }) {
  const overdue = !completed && isTaskOverdue(task);
  return (
    <div className="flex items-center justify-between gap-2 border-b border-hairline pb-2">
      <label className="flex items-center gap-2 min-w-0 cursor-pointer">
        <input
          type="checkbox"
          checked={!!completed}
          disabled={busy}
          onChange={completed ? onReopen : onComplete}
          className="accent-signal"
        />
        <span className={`text-[13px] truncate ${completed ? 'text-text-disabled line-through' : 'text-text-primary'}`}>
          {task.title}
        </span>
        {task.stage_code && (
          <span className="eyebrow text-text-secondary border border-hairline px-1.5 py-0.5 shrink-0">
            {STAGE_LABELS[task.stage_code]}
          </span>
        )}
      </label>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-[11px] text-text-muted">{task.owner ?? '—'}</span>
        <span className={`font-mono text-[11px] ${overdue ? 'text-red-400' : 'text-text-muted'}`}>
          {task.due_date ? fmtDateOnly(task.due_date) : '—'}
          {overdue ? ' · overdue' : ''}
        </span>
        <Button variant="ghost" disabled={busy} onClick={onRemove}>Remove</Button>
      </div>
    </div>
  );
}
