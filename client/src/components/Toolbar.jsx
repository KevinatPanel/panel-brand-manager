// A horizontal toolbar that sits under a ViewHeader. Holds a left-aligned input
// group (search, filters) and a right-aligned input group (toggles, actions),
// pushed to opposite edges via justify-between.
//
// `padding` controls the horizontal inset. Defaults to `px-6` to match the
// header; over a Kanban board pass `px-2` so the input groups line up with the
// cards (which sit at the column's 8px `p-2` inset).
export default function Toolbar({ left, right, padding = 'px-6' }) {
  return (
    <div className={`flex items-center justify-between gap-3 h-12 border-b border-hairline ${padding}`}>
      <div className="flex items-center gap-2">{left}</div>
      <div className="flex items-center gap-2">{right}</div>
    </div>
  );
}
