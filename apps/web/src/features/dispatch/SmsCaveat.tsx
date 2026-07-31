import { Callout } from '../../components/ui'

/**
 * The one place the Twilio SMS limitation is stated.
 *
 * It used to be pasted verbatim in three places on this screen, which is three
 * places to update and two chances to disagree with itself. It belongs beside
 * the channel controls, where it is actionable.
 */
export function SmsCaveat({ className }: { className?: string }) {
  return (
    <Callout tone="info" className={className}>
      SMS delivery depends on the Twilio account: trial accounts block custom-body SMS.
      In this build SMS works end-to-end in seeded/mock mode; voice is the verified live
      channel.
    </Callout>
  )
}
