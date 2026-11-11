const ACCOUNT_KEY = "autovoyage-remembered-account";
const LEGACY_KEY = "autovoyage-remembered-login";

/** Only an account name may persist; remove older password-bearing entries. */
export function rememberedEmail(): string | null {
  try {
    const legacy = localStorage.getItem(LEGACY_KEY);
    let migrated: string | null = null;
    if (legacy !== null) {
      try {
        const stored: unknown = JSON.parse(legacy);
        if (stored && typeof stored === "object" && "email" in stored && typeof stored.email === "string") migrated = stored.email;
      } catch { /* Ignore malformed legacy entries. */ }
      localStorage.removeItem(LEGACY_KEY);
    }
    const saved = localStorage.getItem(ACCOUNT_KEY);
    if (saved !== null) {
      try {
        const stored: unknown = JSON.parse(saved);
        if (stored && typeof stored === "object" && "email" in stored && typeof stored.email === "string") return stored.email || null;
      } catch { /* Invalid account preferences can be discarded. */ }
      localStorage.removeItem(ACCOUNT_KEY);
    }
    if (migrated) localStorage.setItem(ACCOUNT_KEY, JSON.stringify({ email: migrated }));
    return migrated;
  } catch {
    // Private browsing or a full/blocked storage area must not block sign-in.
    try { localStorage.removeItem(LEGACY_KEY); } catch { /* Storage is unavailable. */ }
    return null;
  }
}

export function rememberEmail(email: string | null): void {
  try {
    localStorage.removeItem(LEGACY_KEY);
    if (email) localStorage.setItem(ACCOUNT_KEY, JSON.stringify({ email }));
    else localStorage.removeItem(ACCOUNT_KEY);
  } catch { /* Saving an optional preference must not fail a successful sign-in. */ }
}
