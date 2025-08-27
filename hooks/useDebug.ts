import * as React from 'react';
import { LogLevel, setLogLevel } from 'livekit-client';
// import { useRoomContext } from '@livekit/components-react';
import { AgentSessionInstance } from '@/agent-sdk/agent-session/AgentSession';

export const useDebugMode = ({ session, logLevel }: { session: AgentSessionInstance, logLevel?: LogLevel }) => {
  React.useEffect(() => {
    setLogLevel(logLevel ?? 'debug');

    // @ts-expect-error
    window.__lk_room = session.subtle.room;

    return () => {
      // @ts-expect-error
      window.__lk_room = undefined;
    };
  }, [session.subtle.room, logLevel]);
};
