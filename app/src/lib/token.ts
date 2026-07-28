"use client";

const KEY = "ff_reviewer_token";

/**
 * Resolve the reviewer token: ?r=... wins (and is persisted), otherwise
 * fall back to localStorage. Returns null when neither exists.
 */
export function resolveToken(searchParams: URLSearchParams): string | null {
  const fromUrl = searchParams.get("r");
  if (fromUrl) {
    try {
      window.localStorage.setItem(KEY, fromUrl);
    } catch {
      /* private mode etc. — session still works via the URL */
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
