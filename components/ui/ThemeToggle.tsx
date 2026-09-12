'use client';

import { useTheme, type ThemePreference } from '@/components/providers/ThemeProvider';
import { useIsClient } from '@/hooks/useIsClient';

const ORDER: ThemePreference[] = ['system', 'light', 'dark'];
const LABEL: Record<ThemePreference, string> = { system: 'Auto', light: 'Light', dark: 'Dark' };

export default function ThemeToggle() {
  const { preference, setPreference } = useTheme();
  const isClient = useIsClient();
  const next = ORDER[(ORDER.indexOf(preference) + 1) % ORDER.length];

  return (
    <button
      type="button"
      className="btn btn-ghost"
      onClick={() => setPreference(next)}
      aria-label={`Theme: ${LABEL[preference]}. Switch to ${LABEL[next]}.`}
    >
      Theme: {isClient ? LABEL[preference] : LABEL.system}
    </button>
  );
}
