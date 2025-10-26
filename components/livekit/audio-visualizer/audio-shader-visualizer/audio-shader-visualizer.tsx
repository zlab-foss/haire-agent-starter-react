'use client';

import {
  type TrackReferenceOrPlaceholder,
  useMultibandTrackVolume,
} from '@livekit/components-react';
import { AuroraShaders, type AuroraShadersProps } from '@/components/ui/shadcn-io/aurora-shaders';

export function AudioShaderVisualizer({
  speed = 1.0,
  intensity = 2.0,
  amplitude = 0.5,
  frequency = 0.5,
  scale = 0.3,
  blur = 1.0,
  shape = 1,
  colorPosition = 0.5,
  colorScale = 0.5,
  colorPhase = [0.3, 0.8, 1.0],
  audioTrack,
}: AuroraShadersProps & { audioTrack?: TrackReferenceOrPlaceholder }) {
  const volumeBands = useMultibandTrackVolume(audioTrack, {
    bands: 1,
    loPass: 100,
    hiPass: 200,
  });

  // Map volume to scale for audio reactivity
  // const audioReactiveScale = scale * (0.5 + volumeBands[0] * 0.5);
  const audioReactiveScale = scale;

  return (
    <div className="size-80 overflow-hidden rounded-full">
      <AuroraShaders
        speed={speed}
        intensity={intensity}
        amplitude={amplitude}
        frequency={frequency}
        scale={audioReactiveScale}
        blur={blur}
        shape={shape}
        colorPosition={colorPosition}
        colorScale={colorScale}
        colorPhase={colorPhase}
      />
    </div>
  );
}

// import {
//   CosmicWavesShaders,
//   type CosmicWavesShadersProps,
// } from '@/components/ui/shadcn-io/cosmic-waves-shaders';

// export function AudioShaderVisualizer({
//   speed = 1.0,
//   amplitude = 1.0,
//   frequency = 1.0,
//   starDensity = 1.0,
//   colorShift = 1.0,
// }: CosmicWavesShadersProps) {
//   return (
//     <div className="size-40 overflow-hidden rounded-full">
//       <CosmicWavesShaders
//         speed={speed}
//         amplitude={amplitude}
//         frequency={frequency}
//         starDensity={starDensity}
//         colorShift={colorShift}
//       />
//     </div>
//   );
// }

// import {
//   SingularityShaders,
//   type SingularityShadersProps,
// } from '@/components/ui/shadcn-io/singularity-shaders';

// export function AudioShaderVisualizer({
//   speed = 1.0,
//   intensity = 1.0,
//   size = 1.0,
//   waveStrength = 1.0,
//   colorShift = 1.0,
// }: SingularityShadersProps) {
//   return (
//     <div className="size-40 overflow-hidden rounded-full">
//       <SingularityShaders
//         speed={speed}
//         intensity={intensity}
//         size={size}
//         waveStrength={waveStrength}
//         colorShift={colorShift}
//       />
//     </div>
//   );
// }
