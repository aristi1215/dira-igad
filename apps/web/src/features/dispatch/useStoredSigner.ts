import { useState } from 'react'

const SIGNER_STORAGE_KEY = 'dira.dispatch.signer'

/**
 * The approver's name, remembered between visits.
 *
 * It was retyped from scratch on every single approval, which is friction on
 * the one action nobody should be rushing. Remembering it does not weaken the
 * gate — the name is still written to `alerts.approved_by` with a timestamp on
 * every approval, and "not you?" clears it.
 */
export function useStoredSigner(): [string, (value: string) => void] {
  const [signer, setSignerState] = useState(() => {
    try {
      return window.localStorage.getItem(SIGNER_STORAGE_KEY) ?? ''
    } catch {
      return ''
    }
  })

  const setSigner = (value: string) => {
    setSignerState(value)
    try {
      if (value.trim()) window.localStorage.setItem(SIGNER_STORAGE_KEY, value)
      else window.localStorage.removeItem(SIGNER_STORAGE_KEY)
    } catch {
      // Private-browsing quota errors must not block an approval.
    }
  }

  return [signer, setSigner]
}
