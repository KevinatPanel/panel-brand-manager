// Small helpers for showing the signed-in person.

import { ownerFromEmail } from './stages.js';

// Initials from an email local-part: "kevin.booker@x.com" -> "KB",
// "kevin@x.com" -> "KE". Falls back to "?" when no email.
export function initialsFromEmail(email) {
  if (!email) return '?';
  const local = email.split('@')[0];
  const parts = local.split(/[.\-_]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return local.slice(0, 2).toUpperCase();
}

// Cosmetic full names for display only — the app's owner model (OWNERS in
// stages.js) is first-name-only everywhere else (dropdowns, mentions, note
// authorship). Only the dev bypass account gets a "last name" here, per how
// the user wants it labeled in Settings. A user-set first_name/last_name
// (Supabase auth user_metadata, editable from Settings) always wins over this.
const DISPLAY_NAME_OVERRIDES = { Dev: 'Dev Account' };

// The name shown for the signed-in person, e.g. in Settings — prefers a
// user-set name (Settings' edit form) over the OWNERS identity notes/mentions
// derive from the email (ownerFromEmail). Returns null if neither resolves.
export function accountName(user) {
  const meta = user?.user_metadata ?? {};
  const full = [meta.first_name, meta.last_name].filter(Boolean).join(' ').trim();
  if (full) return full;
  const owner = ownerFromEmail(user?.email);
  if (!owner) return null;
  return DISPLAY_NAME_OVERRIDES[owner] ?? owner;
}

// Initials for the avatar tile — from the user-set name if there is one,
// otherwise falls back to initialsFromEmail.
export function accountInitials(user) {
  const meta = user?.user_metadata ?? {};
  const combined = [meta.first_name, meta.last_name]
    .map((part) => part?.trim()?.[0])
    .filter(Boolean)
    .join('')
    .toUpperCase();
  return combined || initialsFromEmail(user?.email);
}
