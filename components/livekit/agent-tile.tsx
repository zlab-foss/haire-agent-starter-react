import { type AgentState, BarVisualizer, type TrackReference } from '@livekit/components-react';
import { cn } from '@/lib/utils';
import { useMemo } from 'react';
import { RemoteTrackInstance } from '@/agent-sdk/agent-session/RemoteTrack';
import { AgentInstance } from '@/agent-sdk/agent-session/Agent';

interface AgentAudioTileProps {
  state: AgentState;
  agent: AgentInstance | null;
  className?: string;
}

export const AgentTile = ({
  state,
  agent,
  className,
  ref,
}: React.ComponentProps<'div'> & AgentAudioTileProps) => {
  const legacyTrackReference: TrackReference | null = useMemo(() => {
    if (!agent?.microphone || !agent?.subtle.agentParticipant) {
      return null;
    }

    return {
      participant: agent.subtle.agentParticipant, // FIXME: this may not always be right?
      publication: agent.microphone.subtle.publication,
      source: agent.microphone.source,
    };
  }, [agent]);

  return (
    <div ref={ref} className={cn(className)}>
      {legacyTrackReference ? (
        // FIXME: swap out this component, it's old / not in the agents sdk!
        <BarVisualizer
          barCount={5}
          state={state}
          options={{ minHeight: 5 }}
          trackRef={legacyTrackReference}
          className={cn('flex aspect-video w-40 items-center justify-center gap-1')}
        >
          <span
            className={cn([
              'bg-muted min-h-4 w-4 rounded-full',
              'origin-center transition-colors duration-250 ease-linear',
              'data-[lk-highlighted=true]:bg-foreground data-[lk-muted=true]:bg-muted',
            ])}
          />
        </BarVisualizer>
      ) : null}
    </div>
  );
};
