'use client';

import { useEffect } from 'react';
import { useTheme } from 'next-themes';

/** Shops open in the light theme unless the visitor has already picked one (the toggle still works). */
export function LightByDefault() {
  const { setTheme } = useTheme();
  useEffect(() => {
    try {
      if (!localStorage.getItem('theme')) setTheme('light');
    } catch {
      /* storage blocked: the page stays on the computer's setting */
    }
  }, [setTheme]);
  return null;
}
