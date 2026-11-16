/**
 * A person's name from a user reference, or '' when there is none to show.
 *
 * A reference arrives as a populated user ({ firstName, lastName }) from most
 * endpoints, but as a bare id from some write replies. Joining the fields of
 * an id gave "undefined undefined" on screen.
 */
export function personName(person: unknown): string {
  if (!person || typeof person !== 'object') return '';
  const p = person as { fullName?: unknown; firstName?: unknown; lastName?: unknown; name?: unknown };
  if (typeof p.fullName === 'string' && p.fullName.trim() && !p.fullName.includes('undefined')) return p.fullName.trim();
  const joined = [p.firstName, p.lastName].filter((part) => typeof part === 'string' && part.trim()).join(' ');
  if (joined) return joined;
  return typeof p.name === 'string' ? p.name.trim() : '';
}
