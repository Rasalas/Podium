import type { DisplayInfo } from '../../../src/shared/types'
import { describe, expect, it } from 'vitest'
import { pickDisplays } from '../../../src/main/present/pick-displays'

function d(id: number, primary: boolean, internal: boolean): DisplayInfo {
  return { id, label: `D${id}`, primary, internal, bounds: { x: primary ? 0 : 1920, y: 0, width: 1920, height: 1080 } }
}

const laptop = d(1, true, true)
const projector = d(2, false, false)
const third = d(3, false, false)

describe('pickDisplays', () => {
  it('returns undefined without displays', () => {
    expect(pickDisplays([])).toBeUndefined()
  })

  it('single display: audience only', () => {
    expect(pickDisplays([laptop])).toEqual({ audience: laptop })
  })

  it('single display with presenterView: both windows on it', () => {
    expect(pickDisplays([laptop], { presenterView: true })).toEqual({ audience: laptop, presenter: laptop })
  })

  it('two displays: external audience, primary presenter', () => {
    expect(pickDisplays([laptop, projector])).toEqual({ audience: projector, presenter: laptop })
    expect(pickDisplays([projector, laptop])).toEqual({ audience: projector, presenter: laptop })
  })

  it('honours audienceDisplayId', () => {
    expect(pickDisplays([laptop, projector, third], { audienceDisplayId: 3 })).toEqual({ audience: third, presenter: laptop })
  })

  it('audienceDisplayId = primary puts the presenter on the other display', () => {
    expect(pickDisplays([laptop, projector], { audienceDisplayId: 1 })).toEqual({ audience: laptop, presenter: projector })
  })

  it('falls back when the requested display is gone', () => {
    expect(pickDisplays([laptop, projector], { audienceDisplayId: 99 })).toEqual({ audience: projector, presenter: laptop })
  })

  it('presenterView false on two displays: audience only', () => {
    expect(pickDisplays([laptop, projector], { presenterView: false })).toEqual({ audience: projector })
  })

  it('desktop with two external monitors: non-primary is audience', () => {
    const main = d(1, true, false)
    const side = d(2, false, false)
    expect(pickDisplays([main, side])).toEqual({ audience: side, presenter: main })
  })
})
