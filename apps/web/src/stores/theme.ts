import { create } from 'zustand'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'dira-theme'

function readStoredTheme(): Theme | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === 'light' || stored === 'dark' ? stored : null
  } catch {
    return null
  }
}

function preferredTheme(): Theme {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

function initialTheme(): Theme {
  return readStoredTheme() ?? preferredTheme()
}

type ThemeState = {
  theme: Theme
  toggleTheme: () => void
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: initialTheme(),
  toggleTheme: () =>
    set((state) => {
      const theme: Theme = state.theme === 'dark' ? 'light' : 'dark'
      try {
        localStorage.setItem(STORAGE_KEY, theme)
      } catch {
        // Private browsing and disabled storage must not break the chrome.
      }
      return { theme }
    }),
}))
