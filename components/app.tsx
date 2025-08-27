'use client';

import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { toastAlert } from '@/components/alert-toast';
import { SessionView } from '@/components/session-view';
import { Toaster } from '@/components/ui/sonner';
import { Welcome } from '@/components/welcome';
import type { AppConfig } from '@/lib/types';
import { AgentRoomAudioRenderer, AgentStartAudio, useAgentEvents, useAgentSession } from '@/agent-sdk';
import { AgentSessionEvent } from '@/agent-sdk/agent-session/AgentSession';

const MotionWelcome = motion.create(Welcome);
const MotionSessionView = motion.create(SessionView);

interface AppProps {
  appConfig: AppConfig;
}

export function App({ appConfig }: AppProps) {
  const agentSession = useAgentSession();
  (window as any).foo = agentSession;

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
