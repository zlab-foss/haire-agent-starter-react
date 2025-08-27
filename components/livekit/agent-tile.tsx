import { type AgentState, BarVisualizer, type TrackReference } from '@livekit/components-react';
import { cn } from '@/lib/utils';
import { useMemo } from 'react';
import { AgentInstance } from '@/agent-sdk/agent-session/Agent';
import { AgentSessionConnectionState } from '@/agent-sdk/agent-session/AgentSession';

interface AgentAudioTileProps {
  connectionState: AgentSessionConnectionState;
  agent: AgentInstance | null;
  className?: string;
}

export const AgentTile = ({
  connectionState,
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

  const legacyState = useMemo((): AgentState => {
    if (connectionState === 'disconnected' || connectionState === 'connecting') {
      return connectionState;
    } else {
      switch (agent?.conversationalState) {
        case 'initializing':
        case 'idle':
          return 'initializing';

        default:
          return agent?.conversationalState ?? 'initializing';
      }
    }
  }, [connectionState, agent?.conversationalState]);

  return (
    <div ref={ref} className={cn(className)}>
      {legacyTrackReference ? (
        // FIXME: swap out this component, it's old / not in the agents sdk!
        <BarVisualizer
          barCount={5}
          state={legacyState}
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
