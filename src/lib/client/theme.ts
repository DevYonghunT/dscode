'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * 사용자 테마 선호.
 *   "system" — OS prefers-color-scheme 따름 (기본)
 *   "light"  — 강제 라이트
 *   "dark"   — 강제 다크
 *
 * 실제 적용은 <html data-theme="dark|light"> 또는 attribute 제거(=system)로 한다.
 * CSS 의 :root[data-theme="..."] 와 @media (prefers-color-scheme) 가 토큰 swap.
 */
export type ThemePreference = 'system' | 'light' | 'dark'

const LS_KEY = 'dscode_theme'

export function readStoredTheme(): ThemePreference {
  if (typeof window === 'undefined') return 'system'
  try {
    const v = localStorage.getItem(LS_KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    /* ignore */
  }
  return 'system'
}

export function applyTheme(pref: ThemePreference) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (pref === 'system') {
    root.removeAttribute('data-theme')
  } else {
    root.setAttribute('data-theme', pref)
  }
}

export function useTheme() {
  const [pref, setPref] = useState<ThemePreference>('system')
  // load initial value once
  useEffect(() => {
    setPref(readStoredTheme())
  }, [])

  const change = useCallback((next: ThemePreference) => {
    setPref(next)
    try {
      if (next === 'system') localStorage.removeItem(LS_KEY)
      else localStorage.setItem(LS_KEY, next)
    } catch {
      /* ignore */
    }
    applyTheme(next)
  }, [])

  return { pref, change }
}

/**
 * FOUC 방지용 inline script — 라이트 fallback 으로 페인트되었다가 다크로 swap
 * 되는 깜빡임을 막기 위해 <head> 최상단에서 동기 실행한다.
 * layout.tsx 에서 <head> 안 <script dangerouslySetInnerHTML={{ __html: ... }} />.
 */
export const themeBootstrapScript = `
(function(){try{
  var v = localStorage.getItem('${LS_KEY}');
  if (v === 'dark' || v === 'light') {
    document.documentElement.setAttribute('data-theme', v);
  }
}catch(e){}})();
`.trim()
