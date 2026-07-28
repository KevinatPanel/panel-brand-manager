import AnimatedNumber from '../AnimatedNumber.jsx';
import { relativeTime } from '../../lib/leads.js';

// Score + "/100" + relative-updated-time — shared by the company profile
// header and the deal panel's Company Intel section.
export default function ScoreBadge({ score, updatedAt, className = 'font-mono text-signal text-[22px] leading-none' }) {
  return (
    <div className="flex items-baseline gap-2 mt-1">
      <AnimatedNumber value={score} className={className} />
      <span className="font-mono text-text-muted text-[13px]">/100</span>
      <span className="text-text-disabled text-[11px] ml-1">updated {relativeTime(updatedAt)}</span>
    </div>
  );
}
