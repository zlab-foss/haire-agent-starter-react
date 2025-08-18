import * as React from "react";
import { useContext, useEffect, useState, useCallback, useMemo } from "react";
import {
  AudioCaptureOptions,
  Participant,
  ParticipantEvent,
  ScreenShareCaptureOptions,
  Track,
  TrackPublication,
  TrackPublishOptions,
  VideoCaptureOptions,
} from "livekit-client";
import { TrackReference, trackSourceToProtocol } from "@/agent-sdk/external-deps/components-js";
import { ParticipantEventCallbacks } from "../node_modules/livekit-client/src/room/participant/Participant";
import { AgentSession, AgentSessionCallbacks, AgentSessionEvent } from "./agent-session/AgentSession";
import { ReceivedMessage, ReceivedMessageAggregator, ReceivedMessageAggregatorEvent, SentMessage } from "./agent-session/message";
import { AgentCallbacks, AgentEvent } from "./agent-session/Agent";
import { ParticipantPermission } from "livekit-server-sdk";
import { usePersistentUserChoices } from "@livekit/components-react";

// ---------------------
// REACT
// ---------------------

const AgentSessionContext = React.createContext<AgentSession | null>(null);
export const AgentSessionProvider: React.FunctionComponent<React.PropsWithChildren<{ agentSession: AgentSession }>> = ({ agentSession, children }) => (
  <AgentSessionContext.Provider value={agentSession}>
    {children}
  </AgentSessionContext.Provider>
);

export function useAgentSession() {
  const agentSession = useContext(AgentSessionContext);
  if (!agentSession) {
    throw new Error('useAgentSession not used within AgentSessionContext!');
  }
  return agentSession;
}

export function useAgentMessages() {
  const agentSession = useAgentSession();

  const [messagesState, setMessagesState] = useState<
    Array<ReceivedMessage> | null
  >(null);
  useEffect(() => {
    let aggregator: ReceivedMessageAggregator<ReceivedMessage> | null = null;

    const handleUpdated = () => {
      if (!aggregator) {
        return;
      }
      setMessagesState(aggregator.toArray());
    };

    agentSession.createMessageAggregator().then(agg => {
      aggregator = agg;
      setMessagesState(aggregator.toArray());
      aggregator.on(ReceivedMessageAggregatorEvent.Updated, handleUpdated);
    }).catch(err => {
      // FIXME: how should this error be handled?
      console.error('Error creating message aggregator:', err);
    });

    return () => {
      aggregator?.close();
      aggregator?.off(ReceivedMessageAggregatorEvent.Updated, handleUpdated);
      setMessagesState(null);
    };
  }, [agentSession]);

  const send = useCallback(async (message: SentMessage) => {
    return agentSession.sendMessage(message);
  }, [agentSession]);

  const { messages, ready } = useMemo(() => {
    if (messagesState) {
      return { messages: messagesState, ready: true };
    } else {
      return { messages: [], ready: false };
    }
  }, [messagesState]);

  return { ready, messages, send };
}

export function useAgentSessionEvent<EventName extends keyof AgentSessionCallbacks>(
  eventName: EventName,
  callback: AgentSessionCallbacks[EventName],
  dependencies: React.DependencyList,
) {
  const agentSession = useAgentSession();

  // FIXME: is doing this memoiztion here a good idea? Maybe useAgentSessionEvent(..., useCallback(...)) is preferrable?
  const memoizedCallback = useCallback(callback, dependencies);

  useEffect(() => {
    agentSession.on(eventName, memoizedCallback);
    return () => {
      agentSession.off(eventName, memoizedCallback);
    };
  }, [eventName, memoizedCallback]);
}

export function useAgentEvent<EventName extends keyof AgentCallbacks>(
  eventName: EventName,
  callback: AgentCallbacks[EventName],
  dependencies: React.DependencyList,
) {
  const agentSession = useAgentSession();

  // FIXME: is doing this memoiztion here a good idea? Maybe useAgentSessionEvent(..., useCallback(...)) is preferrable?
  const memoizedCallback = useCallback(callback, dependencies);

  useEffect(() => {
    if (!agentSession.agent) {
      return;
    }

    const agent = agentSession.agent;
    agent.on(eventName, memoizedCallback);
    return () => {
      agent.off(eventName, memoizedCallback);
    };
  }, [agentSession.agent, eventName, memoizedCallback]);
}

export function useAgentState() {
  const agentSession = useAgentSession();
  const [agentState, setAgentState] = useState(agentSession.state);
  const [isAvailable, setIsAvailable] = useState(agentSession.isAvailable);

  useAgentSessionEvent(AgentSessionEvent.AgentStateChanged, (newAgentState) => {
    setAgentState(newAgentState);
    setIsAvailable(agentSession.isAvailable);
  }, []);

  return { state: agentState, isAvailable };
}

export function useAgentTracks() {
  const agentSession = useAgentSession();

  const [audioTrack, setAudioTrack] = useState(agentSession.agent?.audioTrack ?? null);
  useAgentEvent(AgentEvent.AudioTrackChanged, setAudioTrack, []);
  const [videoTrack, setVideoTrack] = useState(agentSession.agent?.videoTrack ?? null);
  useAgentEvent(AgentEvent.VideoTrackChanged, setVideoTrack, []);

  return { audioTrack, videoTrack };
}

function useParticipantEvents<P extends Participant, EventName extends keyof ParticipantEventCallbacks>(
  participant: P,
  eventNames: Array<EventName>,
  callback: ParticipantEventCallbacks[EventName],
  dependencies: React.DependencyList,
) {
  // FIXME: is doing this memoiztion here a good idea? Maybe useAgentSessionEvent(..., useCallback(...)) is preferrable?
  const memoizedCallback = useCallback(callback, dependencies);

  useEffect(() => {
    for (const eventName of eventNames) {
      participant.on(eventName, memoizedCallback);
    }
    return () => {
      for (const eventName of eventNames) {
        participant.off(eventName, memoizedCallback);
      }
    };
  }, [participant, eventNames, memoizedCallback]);
}

export function useAgentLocalParticipant(options?: {
  onDeviceError?: (error: Error, source: Track.Source) => void;
  saveUserTrackEnabledChoices?: boolean;
}) {
  const agentSession = useAgentSession();

  const [localParticipant, setLocalParticipant] = React.useState(agentSession.localParticipant);
  const [microphoneTrackPublication, setMicrophoneTrackPublication] = React.useState<TrackPublication | null>(null);
  const [microphoneTrackEnabled, setMicrophoneTrackEnabled] = React.useState(false);
  const [microphoneTrackPending, setMicrophoneTrackPending] = React.useState(false);

  const [cameraTrackPublication, setCameraTrackPublication] = React.useState<TrackPublication | null>(null);
  const [cameraTrackEnabled, setCameraTrackEnabled] = React.useState(false);
  const [cameraTrackPending, setCameraTrackPending] = React.useState(false);

  const [screenShareTrackPublication, setScreenShareTrackPublication] = React.useState<TrackPublication | null>(null);
  const [screenShareTrackEnabled, setScreenShareTrackEnabled] = React.useState(false);
  const [screenShareTrackPending, setScreenShareTrackPending] = React.useState(false);

  const [permissions, setPermissions] = React.useState<ParticipantPermission | null>(null);

  useParticipantEvents(agentSession.localParticipant, [
    ParticipantEvent.TrackMuted,
    ParticipantEvent.TrackUnmuted,
    ParticipantEvent.ParticipantPermissionsChanged,
    // ParticipantEvent.IsSpeakingChanged,
    ParticipantEvent.TrackPublished,
    ParticipantEvent.TrackUnpublished,
    ParticipantEvent.LocalTrackPublished,
    ParticipantEvent.LocalTrackUnpublished,
    ParticipantEvent.MediaDevicesError,
    ParticipantEvent.TrackSubscriptionStatusChanged,
    // ParticipantEvent.ConnectionQualityChanged,
  ], () => {
    setLocalParticipant(agentSession.localParticipant);
    setPermissions(agentSession.localParticipant.permissions ?? null);

    // FIXME: is the rest of this stuff needed?
    // const { isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled } = p;
    const microphoneTrack = agentSession.localParticipant.getTrackPublication(Track.Source.Microphone);
    setMicrophoneTrackPublication(microphoneTrack ?? null);
    setMicrophoneTrackEnabled(localParticipant.isMicrophoneEnabled);

    const cameraTrack = agentSession.localParticipant.getTrackPublication(Track.Source.Camera);
    setCameraTrackPublication(cameraTrack ?? null);
    setCameraTrackEnabled(localParticipant.isCameraEnabled);

    const screenShareTrack = agentSession.localParticipant.getTrackPublication(Track.Source.ScreenShare);
    setScreenShareTrackPublication(screenShareTrack ?? null);
    setScreenShareTrackEnabled(localParticipant.isScreenShareEnabled);
  }, []);

  const publishPermissions = useMemo(() => {
    const canPublishSource = (source: Track.Source) => {
      return (
        permissions?.canPublish &&
        (permissions.canPublishSources.length === 0 ||
          permissions.canPublishSources.includes(trackSourceToProtocol(source)))
      );
    };

    return {
      camera: canPublishSource(Track.Source.Camera),
      microphone: canPublishSource(Track.Source.Microphone),
      screenShare: canPublishSource(Track.Source.ScreenShare),
      data: permissions?.canPublishData ?? false,
    };
  }, [permissions]);

  const microphoneTrack: TrackReference | null = React.useMemo(() => {
    if (!microphoneTrackPublication) {
      return null;
    }
    return {
      participant: localParticipant,
      source: Track.Source.Microphone,
      publication: microphoneTrackPublication,
    };
  }, [localParticipant, microphoneTrackPublication]);

  const cameraTrack: TrackReference | null = React.useMemo(() => {
    if (!cameraTrackPublication) {
      return null;
    }
    return {
      participant: localParticipant,
      source: Track.Source.Camera,
      publication: cameraTrackPublication,
    };
  }, [localParticipant, cameraTrackPublication]);

  const screenShareTrack: TrackReference | null = React.useMemo(() => {
    if (!screenShareTrackPublication) {
      return null;
    }
    return {
      participant: localParticipant,
      source: Track.Source.ScreenShare,
      publication: screenShareTrackPublication,
    };
  }, [localParticipant, screenShareTrackPublication]);

  const {
    saveAudioInputEnabled,
    saveAudioInputDeviceId,
    saveVideoInputEnabled,
    saveVideoInputDeviceId,
  } = usePersistentUserChoices({ // FIXME: replace with agent alternative
    preventSave: !options?.saveUserTrackEnabledChoices,
  });

  const setMicrophoneEnabled = useCallback(async (
    enabled: boolean,
    captureOptions?: AudioCaptureOptions,
    publishOptions?: TrackPublishOptions,
  ) => {
    setMicrophoneTrackPending(true);
    try {
      await localParticipant.setMicrophoneEnabled(
        enabled,
        captureOptions,
        publishOptions,
      );
      saveAudioInputEnabled(enabled);
      setMicrophoneTrackEnabled(enabled);
      return localParticipant.isMicrophoneEnabled;
    } catch (e) {
      if (options?.onDeviceError && e instanceof Error) {
        options?.onDeviceError(e, Track.Source.Microphone);
        return;
      } else {
        throw e;
      }
    } finally {
      setMicrophoneTrackPending(false);
    }
  }, [options?.onDeviceError, setMicrophoneTrackPending, saveAudioInputEnabled, setMicrophoneTrackEnabled]);

  const setCameraEnabled = useCallback(async (
    enabled: boolean,
    captureOptions?: VideoCaptureOptions,
    publishOptions?: TrackPublishOptions,
  ) => {
    setCameraTrackPending(true);
    try {
      await localParticipant.setCameraEnabled(
        enabled,
        captureOptions,
        publishOptions,
      );
      saveVideoInputEnabled(enabled);
      setCameraTrackEnabled(enabled);
      return localParticipant.isMicrophoneEnabled;
    } catch (e) {
      if (options?.onDeviceError && e instanceof Error) {
        options?.onDeviceError(e, Track.Source.Camera);
        return;
      } else {
        throw e;
      }
    } finally {
      setCameraTrackPending(false);
    }
  }, [options?.onDeviceError, setCameraTrackPending, saveVideoInputEnabled, setCameraTrackEnabled]);

  const setScreenShareEnabled = useCallback(async (
    enabled: boolean,
    captureOptions?: ScreenShareCaptureOptions,
    publishOptions?: TrackPublishOptions,
  ) => {
    setScreenShareTrackPending(true);
    try {
      await localParticipant.setScreenShareEnabled(
        enabled,
        captureOptions,
        publishOptions,
      );
      setScreenShareEnabled(enabled);
      return localParticipant.isMicrophoneEnabled;
    } catch (e) {
      if (options?.onDeviceError && e instanceof Error) {
        options?.onDeviceError(e, Track.Source.ScreenShare);
        return;
      } else {
        throw e;
      }
    } finally {
      setScreenShareTrackPending(false);
    }
  }, [options?.onDeviceError, setScreenShareTrackPending, setScreenShareTrackEnabled]);

  const changeAudioDevice = useCallback(
    (deviceId: string) => {
      saveAudioInputDeviceId(deviceId ?? 'default');
    },
    [saveAudioInputDeviceId]
  );

  const changeVideoDevice = useCallback(
    (deviceId: string) => {
      saveVideoInputDeviceId(deviceId ?? 'default');
    },
    [saveVideoInputDeviceId]
  );

  return {
    localParticipant,
    publishPermissions,

    microphone: {
      track: microphoneTrack,
      enabled: microphoneTrackEnabled,
      pending: microphoneTrackPending,
      set: setMicrophoneEnabled,
      toggle: useCallback((
        captureOptions?: AudioCaptureOptions,
        publishOptions?: TrackPublishOptions
      ) => setMicrophoneEnabled(!microphoneTrackEnabled, captureOptions, publishOptions), [microphoneTrackEnabled, setMicrophoneEnabled]),
      changeDevice: changeAudioDevice,
    },
    camera: {
      track: cameraTrack,
      enabled: cameraTrackEnabled,
      pending: cameraTrackPending,
      set: setCameraEnabled,
      toggle: useCallback((
        captureOptions?: VideoCaptureOptions,
        publishOptions?: TrackPublishOptions
      ) => setCameraEnabled(!cameraTrackEnabled, captureOptions, publishOptions), [cameraTrackEnabled, setCameraEnabled]),
      changeDevice: changeVideoDevice,
    },
    screenShare: {
      track: screenShareTrack,
      enabled: screenShareTrackEnabled,
      pending: screenShareTrackPending,
      set: setScreenShareEnabled,
      toggle: useCallback((
        captureOptions?: ScreenShareCaptureOptions,
        publishOptions?: TrackPublishOptions
      ) => setScreenShareEnabled(!screenShareTrackEnabled, captureOptions, publishOptions), [screenShareTrackEnabled, setScreenShareEnabled]),
    },
  };
}

// hook ideas:
// useAgentTracks? (video)
// useAgentControls? (control bar stuff)

export {
  AgentSession,
  AgentSessionEvent,
};
