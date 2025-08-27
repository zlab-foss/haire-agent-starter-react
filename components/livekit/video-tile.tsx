import React from 'react';
import { cn } from '@/lib/utils';
import { AgentVideoTrack } from '@/agent-sdk';

export const VideoTile = ({
  track,
  className,
  ref,
}: React.ComponentProps<'div'> & React.ComponentProps<typeof AgentVideoTrack>) => {
  return (
    <div ref={ref} className={cn('bg-muted overflow-hidden rounded-md', className)}>
      <AgentVideoTrack
        track={track}
        width={track.dimensions?.width ?? 0}
        height={track.dimensions?.height ?? 0}
        className={cn('h-full w-auto')}
      />
    </div>
  );
};
