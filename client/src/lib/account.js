// Small helpers for showing the signed-in person.

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
