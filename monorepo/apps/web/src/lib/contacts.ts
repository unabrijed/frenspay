// contacts.ts — thin wrapper over the Web Contact Picker API (navigator.contacts).
// Real on Android Chrome only (gesture-gated, HTTPS); everywhere else `contactsSupported()`
// is false and callers fall back to manual @handle search. We never store contacts — the
// picked name just prefills the search box, like UPI's "pay your contacts".

interface WebContactsManager {
  select(props: string[], opts?: { multiple?: boolean }): Promise<Array<{ name?: string[]; tel?: string[] }>>;
}

function manager(): WebContactsManager | null {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return null;
  const supported = 'contacts' in navigator && 'ContactsManager' in window;
  const n = navigator as Navigator & { contacts?: WebContactsManager };
  return supported && n.contacts ? n.contacts : null;
}

export function contactsSupported(): boolean {
  return manager() !== null;
}

export interface PickedContact {
  name?: string;
  tel?: string;
}

/** Open the native contact picker and return the first pick. null = unsupported / dismissed. */
export async function pickContact(): Promise<PickedContact | null> {
  const m = manager();
  if (!m) return null;
  try {
    const picked = await m.select(['name', 'tel'], { multiple: false });
    const c = picked[0];
    if (!c) return null;
    return { name: c.name?.[0], tel: c.tel?.[0] };
  } catch {
    return null; // user dismissed or denied permission
  }
}
