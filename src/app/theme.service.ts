import { Injectable, computed, effect, signal } from '@angular/core';

export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'eq-theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private systemDark = signal(window.matchMedia('(prefers-color-scheme: dark)').matches);

  readonly mode = signal<ThemeMode>(this.load());

  /** Resolved boolean used by the app and the map. */
  readonly isDark = computed(() =>
    this.mode() === 'dark' || (this.mode() === 'system' && this.systemDark()),
  );

  constructor() {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', (e) => this.systemDark.set(e.matches));

    effect(() => {
      const dark = this.isDark();
      const mode = this.mode();
      // `system` defers to the OS; explicit modes force the scheme.
      document.body.style.colorScheme = mode === 'system' ? 'light dark' : dark ? 'dark' : 'light';
      document.body.classList.toggle('theme-dark', dark);
      localStorage.setItem(STORAGE_KEY, mode);
    });
  }

  set(mode: ThemeMode): void {
    this.mode.set(mode);
  }

  private load(): ThemeMode {
    const saved = localStorage.getItem(STORAGE_KEY) as ThemeMode | null;
    return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system';
  }
}
