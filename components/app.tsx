'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { RoomEvent } from 'livekit-client';
import { motion } from 'motion/react';
import { RoomAudioRenderer, RoomContext, StartAudio } from '@livekit/components-react';
import { toastAlert } from '@/components/alert-toast';
import { SessionView } from '@/components/session-view';
import { Toaster } from '@/components/ui/sonner';
import { Welcome } from '@/components/welcome';
import useConnectionDetails from '@/hooks/useConnectionDetails';
import type { AppConfig } from '@/lib/types';
import { AgentRoomAudioRenderer, AgentSession, AgentSessionEvent, AgentSessionProvider, AgentStartAudio, useAgentEvent, useAgentEvents, useAgentSession } from '@/agent-sdk';
import { create } from 'zustand';
import { AgentSessionCallbacks, AgentSessionInstance, createAgentSession } from '@/agent-sdk/agent-session/AgentSession';
import { ManualConnectionCredentialsProvider } from '@/agent-sdk/agent-session/ConnectionCredentialsProvider';
import { EventEmitter } from "events";
import TypedEventEmitter, { EventMap } from 'typed-emitter';

const MotionWelcome = motion.create(Welcome);
const MotionSessionView = motion.create(SessionView);

interface AppProps {
  appConfig: AppConfig;
}

export function App({ appConfig }: AppProps) {
  const agentSession = useAgentSession();
  (window as any).foo = agentSession;

  // const agentSession = useAgentSession();

  // const { connectionDetailsProvider } = useConnectionDetails();
  // const oldAgentSession = useMemo(() => new AgentSession(connectionDetailsProvider), [connectionDetailsProvider]);
  const [sessionStarted, setSessionStarted] = useState(false);

  useAgentEvents(agentSession, AgentSessionEvent.Disconnected, () => {
    setSessionStarted(false);
  }, []);

  useAgentEvents(agentSession, AgentSessionEvent.MediaDevicesError, (error) => {
    toastAlert({
      title: 'Encountered an error with your media devices',
      description: `${error.name}: ${error.message}`,
    });
  }, [toastAlert]);

  // useEffect(() => {
  //   const onDisconnected = () => {
  //     setSessionStarted(false);
  //     // connectionDetailsProvider.refresh();
  //   };
  //   const onMediaDevicesError = (error: Error) => {
  //     toastAlert({
  //       title: 'Encountered an error with your media devices',
  //       description: `${error.name}: ${error.message}`,
  //     });
  //   };
  //   oldAgentSession.on(AgentSessionEvent.MediaDevicesError, onMediaDevicesError);
  //   oldAgentSession.on(AgentSessionEvent.Disconnected, onDisconnected);
  //   return () => {
  //     oldAgentSession.off(AgentSessionEvent.Disconnected, onDisconnected);
  //     oldAgentSession.off(AgentSessionEvent.MediaDevicesError, onMediaDevicesError);
  //   };
  // }, [oldAgentSession, connectionDetailsProvider.refresh]);

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
  }, [agentSession.connect, agentSession.disconnect, sessionStarted /* , appConfig.isPreConnectBufferEnabled */]);

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

      <AgentRoomAudioRenderer agent={agentSession.agent} />
      {/* <RoomContext.Provider value={agentSession.subtle.room}> */}
      {/*   <RoomAudioRenderer /> */}
      {/* </RoomContext.Provider> */}
      <AgentStartAudio agentSession={agentSession} label="Start Audio" />
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

      <Toaster />
    </>
  );
}
