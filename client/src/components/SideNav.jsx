import { useState, useRef, useCallback } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Eyebrow } from './ui.jsx';
import { useAuth } from '../state/AuthContext.jsx';
import { useInbox } from '../state/InboxContext.jsx';
import { useLeads } from '../state/LeadsContext.jsx';
import { initialsFromEmail } from '../lib/account.js';
import GlobalSearch from './GlobalSearch.jsx';
import AddLeadModal from './AddLeadModal.jsx';

// Sidebar width is user-resizable within these bounds and remembered across
// reloads. 208px is the original w-52 default.
const MIN_WIDTH = 208;
const MAX_WIDTH = 340;
const STORAGE_KEY = 'sidebar-width';

function clampWidth(w) {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w));
}

function loadWidth() {
  const saved = Number(localStorage.getItem(STORAGE_KEY));
  return saved ? clampWidth(saved) : MIN_WIDTH;
}

// Left sidebar navigation, grouped into labelled sections. The active item is
// marked with a Signal Green left bar.
const SECTIONS = [
  {
    label: 'Overview',
    items: [
      { to: '/home', label: 'Home' },
    ],
  },
  {
    label: 'Directory',
    items: [
      { to: '/people', label: 'People' },
      { to: '/leads', label: 'Companies' },
      // Review Queue only appears once there's something to review.
      { to: '/inbox', label: 'Review Queue', hideWhenEmpty: true },
    ],
  },
  {
    label: 'Sales',
    items: [
      { to: '/outreach', label: 'Outreach' },
      { to: '/meetings', label: 'Meetings' },
    ],
  },
];

export default function SideNav() {
  const { user, signOut } = useAuth();
  const { pending } = useInbox();
  const { leads, verticals, refresh } = useLeads();
  const navigate = useNavigate();
  const [width, setWidth] = useState(loadWidth);
  const [addingClient, setAddingClient] = useState(false);
  const asideRef = useRef(null);

  // A company is a client once it's marked is_client — toggled manually from its
  // profile (CompanyProfile.jsx).
  const clients = leads
    .filter((l) => l.is_client)
    .sort((a, b) => (a.company_name ?? '').localeCompare(b.company_name ?? ''));

  // Drag the right edge to resize. Width is clamped and persisted on release.
  const startResize = useCallback((e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = asideRef.current?.offsetWidth ?? width;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    const onMove = (ev) => setWidth(clampWidth(startW + (ev.clientX - startX)));
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      if (asideRef.current) {
        localStorage.setItem(STORAGE_KEY, String(asideRef.current.offsetWidth));
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [width]);

  return (
    <aside
      ref={asideRef}
      style={{ width }}
      className="shrink-0 sticky top-0 h-screen bg-space border-r border-hairline flex flex-col">
      {/* Wordmark — height matches the ViewHeader so the dividers line up. */}
      <div className="px-5 h-16 flex flex-col justify-center border-b border-hairline">
        <span className="text-text-primary font-semibold tracking-tight text-[15px]">Panel</span>
        <span className="eyebrow text-text-muted mt-0.5">Brand Manager</span>
      </div>

      {/* Global search across deals + leads */}
      <GlobalSearch />

      {/* Sectioned nav */}
      <nav className="flex-1 py-4 overflow-y-auto">
        {SECTIONS.map((section) => {
          const items = section.items.filter((item) => !(item.hideWhenEmpty && pending === 0));
          if (items.length === 0) return null;
          return (
          <div key={section.label} className="mb-5">
            <div className="px-5 mb-1.5">
              <Eyebrow>{section.label}</Eyebrow>
            </div>
            {items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  [
                    'relative flex items-center h-9 px-5 text-[13px] transition-colors',
                    isActive ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary',
                  ].join(' ')
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && <span className="absolute left-0 inset-y-1.5 w-[2px] bg-signal" />}
                    <span className="flex-1">{item.label}</span>
                    {item.to === '/inbox' && pending > 0 && (
                      <span className="ml-2 min-w-[18px] h-[18px] px-1 flex items-center justify-center bg-signal text-space text-[11px] font-medium tabular-nums">
                        {pending}
                      </span>
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </div>
          );
        })}

        {/* Clients — one entry per client, each with its own space. */}
        <div className="mb-5">
          <div className="px-5 mb-1.5 flex items-center justify-between">
            <Eyebrow>Clients</Eyebrow>
            <button
              onClick={() => setAddingClient(true)}
              title="New client"
              className="text-text-muted hover:text-text-primary text-[13px] leading-none transition-colors"
            >
              +
            </button>
          </div>
          {clients.length === 0 ? (
            <div className="px-5 text-text-disabled text-[12px]">No clients yet</div>
          ) : (
            clients.map((c) => (
              <NavLink
                key={c.id}
                to={`/clients/${c.id}`}
                className={({ isActive }) =>
                  [
                    'relative flex items-center h-9 px-5 text-[13px] transition-colors',
                    isActive ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary',
                  ].join(' ')
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && <span className="absolute left-0 inset-y-1.5 w-[2px] bg-signal" />}
                    <span className="flex-1 truncate">{c.company_name}</span>
                  </>
                )}
              </NavLink>
            ))
          )}
        </div>

        {addingClient && (
          <AddLeadModal
            asClient
            verticals={verticals}
            onClose={() => setAddingClient(false)}
            onCreated={(created) => {
              refresh();
              navigate(`/clients/${created.id}`);
            }}
          />
        )}
      </nav>

      {/* Signed-in person — links to Settings; sign out alongside. */}
      <div className="border-t border-hairline px-3 py-3">
        <NavLink
          to="/settings"
          title={user?.email}
          className={({ isActive }) =>
            [
              'flex items-center gap-2.5 px-2 py-1.5 transition-colors',
              isActive ? 'bg-card-hover' : 'hover:bg-card-hover',
            ].join(' ')
          }
        >
          <div className="h-7 w-7 shrink-0 flex items-center justify-center bg-space border border-hairline text-text-primary text-[11px] font-medium">
            {initialsFromEmail(user?.email)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-text-primary text-[12px] truncate">
              {user?.email ?? 'Account'}
            </div>
            <div className="eyebrow text-text-muted">Settings</div>
          </div>
        </NavLink>
        <button
          onClick={signOut}
          className="mt-2 px-2 text-text-secondary hover:text-text-primary text-[12px] transition-colors"
        >
          Sign out
        </button>
      </div>

      {/* Drag handle — resize the sidebar within MIN/MAX bounds. */}
      <div
        onMouseDown={startResize}
        onDoubleClick={() => {
          setWidth(MIN_WIDTH);
          localStorage.setItem(STORAGE_KEY, String(MIN_WIDTH));
        }}
        title="Drag to resize · double-click to reset"
        className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-signal/30 active:bg-signal/50 transition-colors"
      />
    </aside>
  );
}
