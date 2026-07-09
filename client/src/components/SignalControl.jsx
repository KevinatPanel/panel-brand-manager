import { Input, Select } from './ui.jsx';

// Is a stored value a date string (used by recent_funding's toggle+date)?
const isDateValue = (v) => v && !['Yes', 'No', 'Unknown'].includes(v) && !Number.isNaN(Date.parse(v));

// Segmented toggle (Yes / No / Unknown), options driven by config.
function Toggle({ options, value, onChange }) {
  return (
    <div className="flex border border-hairline w-full">
      {options.map((o, i) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={[
              'flex-1 py-1.5 text-[12px] transition-colors',
              i > 0 ? 'border-l border-hairline' : '',
              active
                ? 'bg-card-hover text-text-primary'
                : 'text-text-muted hover:text-text-secondary',
            ].join(' ')}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// Renders the right input for a signal and reports value changes via onChange.
// key_contacts (derived) is read-only here — it is driven by the Contacts list.
export default function SignalControl({ config, value, onChange }) {
  const opts = Array.isArray(config.options) ? config.options : [];

  if (config.input_type === 'derived') {
    return (
      <div className="text-text-muted text-[12px] italic">Auto from contacts below</div>
    );
  }

  if (config.input_type === 'number') {
    return (
      <Input
        type="number"
        min="0"
        defaultValue={value ?? ''}
        onBlur={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        placeholder="Exact $ amount"
        className="font-mono"
      />
    );
  }

  if (config.input_type === 'text') {
    return (
      <Input defaultValue={value ?? ''} onBlur={(e) => onChange(e.target.value || null)} placeholder="—" />
    );
  }

  if (config.input_type === 'select') {
    return (
      <Select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">— Select —</option>
        {opts.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </Select>
    );
  }

  // toggle (optionally toggle + date for recent_funding)
  const onDate = isDateValue(value);
  const toggleVal = onDate ? 'Yes' : value ?? '';

  return (
    <div className="space-y-2">
      <Toggle
        options={opts}
        value={toggleVal}
        onChange={(v) => {
          // For a date-bearing toggle, picking "Yes" keeps an existing date.
          if (config.has_date && v === 'Yes' && onDate) return;
          onChange(v);
        }}
      />
      {config.has_date && toggleVal === 'Yes' && (
        <Input
          type="date"
          value={onDate ? value.slice(0, 10) : ''}
          onChange={(e) => onChange(e.target.value || 'Yes')}
          style={{ colorScheme: 'dark' }}
          className="font-mono"
        />
      )}
    </div>
  );
}
