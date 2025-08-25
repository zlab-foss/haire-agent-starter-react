'use client';

import { useEffect, useMemo, useState } from 'react';
import { RoomEvent } from 'livekit-client';
import { motion } from 'motion/react';
import { RoomAudioRenderer, RoomContext, StartAudio } from '@livekit/components-react';
import { toastAlert } from '@/components/alert-toast';
import { SessionView } from '@/components/session-view';
import { Toaster } from '@/components/ui/sonner';
import { Welcome } from '@/components/welcome';
import useConnectionDetails from '@/hooks/useConnectionDetails';
import type { AppConfig } from '@/lib/types';
import { AgentSession, AgentSessionEvent, AgentSessionProvider, useAgentEvent } from '@/agent-sdk';
import { create } from 'zustand';
import { AgentSessionInstance, createAgentSession } from '@/agent-sdk/agent-session/AgentSession';
import { ManualConnectionCredentialsProvider } from '@/agent-sdk/agent-session/ConnectionCredentialsProvider';
import { EventEmitter } from "events";

const MotionWelcome = motion.create(Welcome);
const MotionSessionView = motion.create(SessionView);

interface AppProps {
  appConfig: AppConfig;
}

const emitter = new EventEmitter();
const useAgentSession = create<AgentSessionInstance>((set, get) => {
  return createAgentSession({
    credentials: new ManualConnectionCredentialsProvider(async () => {
      const url = new URL(
        process.env.NEXT_PUBLIC_CONN_DETAILS_ENDPOINT ?? '/api/connection-details',
        window.location.origin
      );

      let data;
      try {
        const res = await fetch(url.toString());
        data = await res.json();
      } catch (error) {
        console.error('Error fetching connection details:', error);
        throw new Error('Error fetching connection details!');
      }

      return data;
    }),
  }, get, set, emitter as any);
});

export function App({ appConfig }: AppProps) {
  const { connectionDetailsProvider } = useConnectionDetails();
  const agentSession = useMemo(() => new AgentSession(connectionDetailsProvider), [connectionDetailsProvider]);
  const [sessionStarted, setSessionStarted] = useState(false);

  const foo = useAgentSession();
  (window as any).foo = foo;

  useEffect(() => {
    const onDisconnected = () => {
      setSessionStarted(false);
      connectionDetailsProvider.refresh();
    };
    const onMediaDevicesError = (error: Error) => {
      toastAlert({
        title: 'Encountered an error with your media devices',
        description: `${error.name}: ${error.message}`,
      });
    };
    agentSession.room.on(RoomEvent.MediaDevicesError, onMediaDevicesError);
    agentSession.room.on(RoomEvent.Disconnected, onDisconnected);
    return () => {
      agentSession.room.off(RoomEvent.Disconnected, onDisconnected);
      agentSession.room.off(RoomEvent.MediaDevicesError, onMediaDevicesError);
    };
  }, [agentSession, connectionDetailsProvider.refresh]);

  useEffect(() => {
    let aborted = false;
    if (sessionStarted && agentSession.connectionState === 'disconnected') {
      agentSession.connect().catch((error) => {
        if (aborted) {
          // Once the effect has cleaned up after itself, drop any errors
          //
          // These errors are likely caused by this effect rerunning rapidly,
          // resulting in a previous run `disconnect` running in parallel with
          // a current run `connect`
          return;
        }

        toastAlert({
          title: 'There was an error connecting to the agent',
          description: `${error.name}: ${error.message}`,
        });
      });
    }
    return () => {
      aborted = true;
      agentSession.disconnect();
    };
  }, [agentSession, sessionStarted /* , appConfig.isPreConnectBufferEnabled */]);

  const { startButtonText } = appConfig;

  return (
    <>
      <MotionWelcome
        key="welcome"
        startButtonText={startButtonText}
        onStartCall={() => setSessionStarted(true)}
        disabled={sessionStarted}
        initial={{ opacity: 0 }}
        animate={{ opacity: sessionStarted ? 0 : 1 }}
        transition={{ duration: 0.5, ease: 'linear', delay: sessionStarted ? 0 : 0.5 }}
      />

      <AgentSessionProvider agentSession={agentSession}>
        <RoomContext.Provider value={agentSession.room}>
          <RoomAudioRenderer />
          <StartAudio label="Start Audio" />
          {/* --- */}
          <MotionSessionView
            key="session-view"
            appConfig={appConfig}
            disabled={!sessionStarted}
            sessionStarted={sessionStarted}
            initial={{ opacity: 0 }}
            animate={{ opacity: sessionStarted ? 1 : 0 }}
            transition={{
              duration: 0.5,
              ease: 'linear',
              delay: sessionStarted ? 0.5 : 0,
            }}
          />
        </RoomContext.Provider>
      </AgentSessionProvider>

      <Toaster />
    </>
  );
}
