"use client";

const KEY = "ff_reviewer_token";

/**
 * Resolve the reviewer token: ?r=... wins (and is persisted), otherwise
 * fall back to localStorage. Returns null when neither exists.
 */
export function resolveToken(searchParams: URLSearchParams): string | null {
  const fromUrl = searchParams.get("r");
  if (fromUrl) {
    let persisted = false;
    try {
      window.localStorage.setItem(KEY, fromUrl);
      persisted = true;
    } catch {
      /* private mode etc. — session still works via the URL */
    }
    // Keep tokens out of the address bar so any URL someone copies and
    // shares never carries their identity. Only once the token is safely
    // persisted — otherwise a reload would log them out.
    if (persisted) {
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete("r");
        window.history.replaceState(window.history.state, "", url.toString());
      } catch {
        /* ignore — cosmetic */
      }
    }
    return fromUrl;
  }
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function clearToken() {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
