import { Eyebrow } from './ui.jsx';

// Standard view header: title + subtitle on the left, actions on the right.
export default function ViewHeader({ title, subtitle, children }) {
  return (
    <div className="flex items-center justify-between px-6 h-16 border-b border-hairline">
      <div>
        <Eyebrow className="mb-1">{title}</Eyebrow>
        {subtitle && <div className="text-text-secondary text-[13px]">{subtitle}</div>}
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}
