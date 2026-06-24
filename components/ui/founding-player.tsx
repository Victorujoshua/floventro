'use client'

import { useEffect, useRef } from 'react'
import { Player } from '@remotion/player'
import type { PlayerRef } from '@remotion/player'
import { FoundingComposition } from './founding-motion'

export default function FoundingPlayer() {
  const ref = useRef<PlayerRef>(null)
  useEffect(() => { ref.current?.play() }, [])

  return (
    <Player
      ref={ref}
      component={FoundingComposition}
      durationInFrames={360}
      fps={30}
      compositionWidth={400}
      compositionHeight={400}
      loop
      autoPlay
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
