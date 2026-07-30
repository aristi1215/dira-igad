export const WELCOME_STORAGE_KEY = 'dira-welcome-v1'

export function readWelcomeDismissed(): boolean {
  try {
    return localStorage.getItem(WELCOME_STORAGE_KEY) === 'dismissed'
  } catch {
    return false
  }
}

export function writeWelcomeDismissed(): void {
  try {
    localStorage.setItem(WELCOME_STORAGE_KEY, 'dismissed')
  } catch {
    // Storage can be unavailable (private mode); onboarding still works.
  }
}
