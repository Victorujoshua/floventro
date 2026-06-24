'use client'

import { useEffect, useRef } from 'react'
import { Player } from '@remotion/player'
import type { PlayerRef } from '@remotion/player'
import { HeroComposition } from './hero-motion'

export default function HeroPlayer() {
  const ref = useRef<PlayerRef>(null)

  // Belt-and-suspenders: autoPlay prop + imperative play() for browsers
  // that need user-gesture context to be established first.
  useEffect(() => {
    ref.current?.play()
  }, [])

  return (
    <Player
      ref={ref}
      component={HeroComposition}
      durationInFrames={240}
      fps={30}
      compositionWidth={400}
      compositionHeight={400}
      loop
      autoPlay
      // Disable audio system — pure visual composition.
      // Without this the Player waits for AudioContext.resume() (requires
      // user gesture) before scheduling requestAnimationFrame, so it never
      // starts playing.
      numberOfSharedAudioTags={0}
      initiallyMuted
      controls={false}
      clickToPlay={false}
      showVolumeControls={false}
      initiallyShowControls={false}
      style={{ width: '100%' }}
    />
  )
}
