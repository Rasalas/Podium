import type { DisplayInfo } from '../../shared/types'

export interface PickOptions {
  audienceDisplayId?: number
  /** Show the presenter view. Default: true when two or more displays exist. */
  presenterView?: boolean
}

export interface PickedDisplays {
  audience: DisplayInfo
  /** Display for the presenter window, undefined when there is none. */
  presenter?: DisplayInfo
}

/**
 * Audience: the requested display if it exists, else the first external one
 * (non-primary, non-internal first), else the only display.
 * Presenter: with two or more displays the primary/internal one that is not
 * the audience display; with one display only when `presenterView` is true
 * (then it shares the display with the audience window).
 */
export function pickDisplays(displays: DisplayInfo[], options: PickOptions = {}): PickedDisplays | undefined {
  if (!displays.length)
    return undefined
  let audience = options.audienceDisplayId === undefined
    ? undefined
    : displays.find(d => d.id === options.audienceDisplayId)
  if (!audience) {
    audience = displays.find(d => !d.primary && !d.internal)
      ?? displays.find(d => !d.primary)
      ?? displays[0]
  }
  const others = displays.filter(d => d.id !== audience.id)
  const wantPresenter = options.presenterView ?? others.length > 0
  if (!wantPresenter)
    return { audience }
  const presenter = others.find(d => d.primary) ?? others.find(d => d.internal) ?? others[0] ?? audience
  return { audience, presenter }
}
