import React from 'react';
import { motion } from 'motion/react';
import { VideoTrack } from '@livekit/components-react';
import { cn } from '@/lib/utils';
import { AgentVideoTrack } from '@/agent-sdk';

// const MotionVideoTrack = motion.create(VideoTrack);
//
// export const VideoTile = ({
//   trackRef,
//   className,
//   ref,
// }: React.ComponentProps<'div'> & React.ComponentProps<typeof VideoTrack>) => {
//   return (
//     <div ref={ref} className={cn('bg-muted overflow-hidden rounded-md', className)}>
//       <MotionVideoTrack
//         trackRef={trackRef}
//         width={trackRef?.publication.dimensions?.width ?? 0}
//         height={trackRef?.publication.dimensions?.height ?? 0}
//         className={cn('h-full w-auto')}
//       />
//     </div>
//   );
// };

const MotionAgentVideoTrack = motion.create(AgentVideoTrack);

export const VideoTile = ({
  track,
  className,
  ref,
}: React.ComponentProps<'div'> & React.ComponentProps<typeof AgentVideoTrack>) => {
  return (
    <div ref={ref} className={cn('bg-muted overflow-hidden rounded-md', className)}>
      {/* <MotionVideoTrack */}
      <MotionAgentVideoTrack
        // trackRef={trackRef}
        track={track}
        width={track.dimensions?.width ?? 0}
        height={track.dimensions?.height ?? 0}
        className={cn('h-full w-auto')}
      />
    </div>
  );
};
