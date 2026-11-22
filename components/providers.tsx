'use client';

import { ThemeProvider, useTheme } from 'next-themes';
import { Toaster } from 'sonner';

function Toasts() {
  const { resolvedTheme } = useTheme();
  return <Toaster position="top-right" richColors closeButton theme={resolvedTheme === 'dark' ? 'dark' : 'light'} toastOptions={{ duration: 4000 }} />;
}

/** Light / dark theme (remembered, follows the computer's setting by default) and toast messages. */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
      <Toasts />
    </ThemeProvider>
  );
}
