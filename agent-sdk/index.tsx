import * as React from "react";
import { useContext, useEffect, useState, useCallback, useMemo, useRef } from "react";
import { EventEmitter } from "events";
import { create } from 'zustand';
import {
  Room,
  AudioCaptureOptions,
  LocalAudioTrack,
  LocalVideoTrack,
  Participant,
  ParticipantEvent,
  ScreenShareCaptureOptions,
  Track,
  TrackPublication,
  TrackPublishOptions,
  VideoCaptureOptions,
  LocalTrack,
} from "livekit-client";
import { TrackReference, trackSourceToProtocol } from "@/agent-sdk/external-deps/components-js";
import { ParticipantEventCallbacks } from "../node_modules/livekit-client/src/room/participant/Participant";
import { AgentSession, AgentSessionCallbacks, AgentSessionEvent, AgentSessionInstance, createAgentSession, SwitchActiveDeviceOptions } from "./agent-session/AgentSession";
import { ReceivedMessage, ReceivedMessageAggregator, ReceivedMessageAggregatorEvent, SentChatMessageOptions, SentMessage, SentMessageOptions } from "./agent-session/message";
import { AgentCallbacks, AgentEvent, AgentInstance } from "./agent-session/Agent";
import { ParticipantPermission } from "livekit-server-sdk";
import { AudioTrack, usePersistentUserChoices } from "@livekit/components-react";
import { RemoteTrackInstance } from "./agent-session/RemoteTrack";
import { ManualConnectionCredentialsProvider } from "./agent-session/ConnectionCredentialsProvider";
import TypedEventEmitter, { EventMap } from "typed-emitter";
import { LocalTrackInstance } from "./agent-session/LocalTrack";

// ---------------------
// REACT
// ---------------------

const AgentSessionContext = React.createContext<AgentSession | null>(null);
export const AgentSessionProvider: React.FunctionComponent<React.PropsWithChildren<{ agentSession: AgentSession }>> = ({ agentSession, children }) => (
  <AgentSessionContext.Provider value={agentSession}>
    {children}
  </AgentSessionContext.Provider>
);

export function useAgentSessionOLD() {
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
  }, [agentSession, agentSession.isAvailable]);

  const send = useCallback(async <Message extends SentMessage | string>(
    message: SentMessage | string,
    options: Message extends SentMessage ? SentMessageOptions<Message> : SentChatMessageOptions,
  ) => {
    return agentSession.sendMessage(message, options);
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
  const [connectionState, setConnectionState] = useState(agentSession.connectionState);
  const [conversationalState, setConversationalState] = useState(agentSession.conversationalState);
  const [isAvailable, setIsAvailable] = useState(agentSession.isAvailable);
  const [isConnected, setIsConnected] = useState(agentSession.isConnected);

  useAgentSessionEvent(AgentSessionEvent.AgentConnectionStateChanged, (newState) => {
    setConnectionState(newState);
    setIsAvailable(agentSession.isAvailable);
    setIsConnected(agentSession.isConnected);
  }, []);
  useAgentSessionEvent(AgentSessionEvent.AgentConversationalStateChanged, (newState) => {
    setConversationalState(newState);
    setIsAvailable(agentSession.isAvailable);
    setIsConnected(agentSession.isConnected);
  }, []);

  const legacyState = useMemo((): 'disconnected' | 'connecting' | 'initializing' | 'listening' | 'thinking' | 'speaking' => {
    if (connectionState === 'disconnected' || connectionState === 'connecting') {
      return connectionState;
    } else {
      switch (conversationalState) {
        case 'initializing':
        case 'idle':
          return 'initializing';

        default:
          return conversationalState;
      }
    }
  }, [connectionState, conversationalState]);

  return {
    connectionState,
    conversationalState,
    /** @deprecated Use connectionState / conversationalState insread of legacyState */
    legacyState,
    isAvailable,
    isConnected
  };
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

export function useAgentMediaDeviceSelect({ kind, requestPermissions, onError }: {
  kind: MediaDeviceKind,
  requestPermissions?: boolean;
  onError?: (error: Error) => void;
}) {
  const agentSession = useAgentSession();

  // List of all devices.
  const [devices, setDevices] = useState<Array<MediaDeviceInfo>>([]);
  useEffect(() => {
    const onDeviceChange = async () => {
      const devicesPromise = Room.getLocalDevices(kind, requestPermissions).then(setDevices);
      if (onError) {
        return devicesPromise.catch(onError);
      } else {
        return devicesPromise;
      }
    };

    if (typeof window !== 'undefined') {
      if (!window.isSecureContext) {
        throw new Error(
          `Accessing media devices is available only in secure contexts (HTTPS and localhost), in some or all supporting browsers. See: https://developer.mozilla.org/en-US/docs/Web/API/Navigator/mediaDevices`,
        );
      }
      navigator?.mediaDevices?.addEventListener('devicechange', onDeviceChange);
    }

    return () => {
      navigator?.mediaDevices?.removeEventListener('devicechange', onDeviceChange);
    };
  }, [kind, requestPermissions, onError]);

  // Active device management.
  const [currentDeviceId, setCurrentDeviceId] = useState(
    agentSession.getActiveDevice(kind) ?? 'default',
  );
  const setActiveMediaDevice = useCallback(async (id: string, options: SwitchActiveDeviceOptions = {}) => {
    // FIXME: use actual logger of some sort?
    console.debug(`Switching active device of kind "${kind}" with id ${id}.`);
    await agentSession.switchActiveDevice(kind, id, options);

    const actualDeviceId: string | undefined = agentSession.getActiveDevice(kind) ?? id;
    if (actualDeviceId !== id && id !== 'default') {
      // FIXME: use actual logger of some sort?
      console.info(
        `We tried to select the device with id (${id}), but the browser decided to select the device with id (${actualDeviceId}) instead.`,
      );
    }

    let targetTrack: LocalTrack | undefined = undefined;
    if (kind === 'audioinput') {
      targetTrack = agentSession.room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track;
    } else if (kind === 'videoinput') {
      targetTrack = agentSession.room.localParticipant.getTrackPublication(Track.Source.Camera)?.track;
    }

    const useDefault =
      (id === 'default' && !targetTrack) ||
      (id === 'default' && targetTrack?.mediaStreamTrack.label.startsWith('Default'));

    let newCurrentDeviceId = useDefault ? id : actualDeviceId;
    if (newCurrentDeviceId) {
      setCurrentDeviceId(newCurrentDeviceId);
    }
  }, [agentSession]);

  return { devices, activeDeviceId: currentDeviceId, setActiveMediaDevice };
}

export function useAgentLocalParticipantPermissions() {
  const agentSession = useAgentSession();

  const [permissions, setPermissions] = useState(agentSession.localParticipant.permissions);
  useEffect(() => {
    agentSession.localParticipant.on(ParticipantEvent.ParticipantPermissionsChanged, setPermissions);
    return () => {
      agentSession.localParticipant.off(
        ParticipantEvent.ParticipantPermissionsChanged,
        setPermissions
      );
    };
  }, [agentSession.localParticipant]);

  return permissions;
}

// hook ideas:
// useAgentTracks? (video)
// useAgentControls? (control bar stuff)

export const AgentVideoTrack: React.FunctionComponent<{
  className?: string,
  track: LocalTrackInstance<Track.Source.Camera | Track.Source.ScreenShare> | RemoteTrackInstance<Track.Source.Camera | Track.Source.ScreenShare>,
} & React.HTMLAttributes<HTMLVideoElement>> = ({ track, ...rest }) => {
  // FIXME: imperative handle logic
  const mediaElementRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!mediaElementRef.current) {
      return;
    }
    const mediaElement = mediaElementRef.current;

    let cleanup: (() => void) | null = null;
    (async () => {
      if (!track.isLocal) {
        // FIXME: intersection observer logic
        track.setSubscribed(true);
        await track.waitUntilSubscribed();
      }

      cleanup = track.attachToMediaElement(mediaElement);
    })()

    return () => {
      if (!track.isLocal) {
        track.setSubscribed(false);
      }
      cleanup?.();
    };
  }, [track]);

  return (
    <video
      ref={mediaElementRef}
      data-lk-local-participant={false}
      data-lk-source={track.source}
      data-lk-orientation={track.orientation}
      muted={true}
      // onClick={clickHandler}
      {...rest}
    />
  );
};

export const AgentAudioTrack: React.FunctionComponent<{ className?: string, track: RemoteTrackInstance<Track.Source.Microphone>, volume?: number, muted?: boolean }> = (props) => {
  // FIXME: imperative handle logic
  const mediaElementRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (typeof props.volume === 'undefined') {
      return;
    }
    props.track.setVolume(props.volume);
  }, [props.volume]);

  useEffect(() => {
    if (!mediaElementRef.current) {
      return;
    }
    const mediaElement = mediaElementRef.current;

    let cleanup: (() => void) | null = null;
    (async () => {
      props.track.setSubscribed(true);
      await props.track.waitUntilSubscribed();

      cleanup = props.track.attachToMediaElement(mediaElement);
    })()

    return () => {
      props.track.setSubscribed(false);
      cleanup?.();
    };
  }, [props.track]);

  useEffect(() => {
    props.track.setEnabled(!props.muted);
  }, [props.track, props.muted]);

  return (
    <audio
      className={props.className}
      ref={mediaElementRef}
      data-lk-local-participant={false}
      data-lk-source={props.track.source}
    />
  );
};

export const AgentRoomAudioRenderer: React.FunctionComponent<{ agent: AgentInstance | null, volume?: number, muted?: boolean }> = (props) => {
  return (
    <div style={{ display: 'none' }}>
      {/* FIXME: Add [Track.Source.Microphone, Track.Source.ScreenShareAudio, Track.Source.Unknown] */}
      {props.agent?.microphone ? (
        <AgentAudioTrack
          track={props.agent.microphone}
          volume={props.volume}
          muted={props.muted}
        />
      ) : null}
    </div>
  );
};

export const AgentStartAudio: React.FunctionComponent<{ className?: string, agentSession: AgentSessionInstance, label: string }> = ({ className, label = 'Allow Audio', agentSession }) => {
  return (
    <button
      className={className}
      style={{ display: agentSession.canPlayAudio ? 'none' : 'block'}}
      onClick={() => agentSession.startAudio()}
    >
      {label}
    </button>
  );
};


const emitter = new EventEmitter();
export const useAgentSession = create<AgentSessionInstance>((set, get) => {
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

export function useAgentEvents<
  Emitter extends TypedEventEmitter<EventMap>,
  EmitterEventMap extends (Emitter extends TypedEventEmitter<infer EM> ? EM : never),
  Event extends Parameters<Emitter["on"]>[0],
  Callback extends EmitterEventMap[Event],
>(
  instance: { subtle: { emitter: Emitter } },
  event: Event,
  handlerFn: Callback | undefined,
  dependencies?: React.DependencyList
) {
  const fallback = useMemo(() => () => {}, []);
  const wrappedCallback = useCallback(handlerFn ?? fallback, dependencies ?? []);
  const callback = dependencies ? wrappedCallback : handlerFn;

  useEffect(() => {
    if (!callback) {
      return;
    }
    instance.subtle.emitter.on(event, callback);
    return () => {
      instance.subtle.emitter.off(event, callback);
    };
  }, [instance.subtle.emitter, event, callback]);
}


export {
  AgentSession,
  AgentSessionEvent,
};
