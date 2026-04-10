"use client";

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

const VISITOR_STORAGE_KEY = 'anime-track:visitor-id';
const SESSION_STORAGE_KEY = 'anime-track:session-id';

function createId(prefix: string) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
  }

  return `${prefix}_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function getPersistedId(storage: Storage, key: string, prefix: string) {
  try {
    const existing = storage.getItem(key);
    if (existing) return existing;

    const next = createId(prefix);
    storage.setItem(key, next);
    return next;
  } catch {
    return createId(prefix);
  }
}

export default function AccessTracker() {
  const pathname = usePathname();
  const previousPathRef = useRef<string | null>(null);
  const lastSentRef = useRef<{ pathname: string; at: number } | null>(null);

  useEffect(() => {
    if (!pathname || typeof window === 'undefined') return;

    const now = Date.now();
    if (lastSentRef.current && lastSentRef.current.pathname === pathname && now - lastSentRef.current.at < 4000) {
      previousPathRef.current = pathname;
      return;
    }

    lastSentRef.current = { pathname, at: now };

    const visitorId = getPersistedId(window.localStorage, VISITOR_STORAGE_KEY, 'visitor');
    const sessionId = getPersistedId(window.sessionStorage, SESSION_STORAGE_KEY, 'session');
    const referrer = previousPathRef.current ?? document.referrer ?? null;
    previousPathRef.current = pathname;

    void fetch('/api/traffic', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pathname, visitorId, sessionId, referrer }),
      keepalive: true,
      cache: 'no-store',
    }).catch(() => undefined);
  }, [pathname]);

  return null;
}