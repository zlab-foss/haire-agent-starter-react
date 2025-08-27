import { cn } from '@/lib/utils';
import { AgentInstance } from '@/agent-sdk/agent-session/Agent';
import { AgentSessionConnectionState } from '@/agent-sdk/agent-session/AgentSession';
import { AgentBarVisualizer } from '@/agent-sdk';

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
  return (
    <div ref={ref} className={cn(className)}>
      <AgentBarVisualizer
        barCount={5}
        connectionState={connectionState}
        options={{ minHeight: 5 }}
        agent={agent}
        participant={agent?.subtle.agentParticipant /* FIXME: this may not always be right? */ ?? null}
        track={agent?.microphone ?? null}
        className={cn('flex aspect-video w-40 items-center justify-center gap-1')}
      >
        <span
          className={cn([
            'bg-muted min-h-4 w-4 rounded-full',
            'origin-center transition-colors duration-250 ease-linear',
            'data-[lk-highlighted=true]:bg-foreground data-[lk-muted=true]:bg-muted',
          ])}
        />
      </AgentBarVisualizer>
    </div>
  );
};
