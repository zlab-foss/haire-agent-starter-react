import * as React from "react";
import { useEffect, useCallback, useMemo, useRef } from "react";
import { EventEmitter } from "events";
import { create } from 'zustand';
import { Participant, Track, TrackPublication } from "livekit-client";
import { AgentSessionConnectionState, AgentSessionInstance, AgentSessionOptions, createAgentSession } from "./agent-session/AgentSession";
import { AgentInstance } from "./agent-session/Agent";
import { RemoteTrackInstance } from "./agent-session/RemoteTrack";
import TypedEventEmitter, { EventMap } from "typed-emitter";
import { LocalTrackInstance } from "./agent-session/LocalTrack";
import { AgentState, BarVisualizer, BarVisualizerProps, TrackReference } from "@livekit/components-react";
import { ManualConnectionCredentialsProvider } from "./agent-session/ConnectionCredentialsProvider";

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

    if (!track.enabled) {
      return;
    }

    let cleanup: (() => void) | null = null;
    (async () => {
      if (!track.isLocal) {
        // FIXME: intersection observer logic
        track.setSubscribed(true);
        await track.waitUntilSubscribed(); // FIXME: move inside of attachToMediaElement
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
      await props.track.waitUntilSubscribed(); // FIXME: move inside of attachToMediaElement

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

export const AgentStartAudio: React.FunctionComponent<{ className?: string, agentSession: AgentSessionInstance, label?: string }> = ({ className, label = 'Allow Audio', agentSession }) => {
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

/**
  * @deprecated FIXME: add a fully owned implementation of this!
  */
export const AgentBarVisualizer: React.FunctionComponent<
  Exclude<BarVisualizerProps, 'state' | 'trackRef'> & {
    connectionState: AgentSessionConnectionState,
    agent: AgentInstance | null,
    participant: Participant | null,
    track: LocalTrackInstance<Track.Source> | RemoteTrackInstance<Track.Source> | null,
  }
> = ({ connectionState, agent, participant, track, ...rest }) => {
  const legacyTrackReference: TrackReference | null = useMemo(() => {
    if (!participant || !track?.subtle.publication) {
      return null;
    }

    return {
      participant,
      publication: track.subtle.publication as TrackPublication,
      source: track.source,
    };
  }, [participant, track]);

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

  if (!legacyTrackReference) {
    // FIXME: this doesn't handle the "placeholder" state right, figure that out!
    return null;
  }

  return (
    <BarVisualizer
      state={legacyState}
      trackRef={legacyTrackReference}
      {...rest}
    />
  );
};


const emitter = new EventEmitter();
export const createUseAgentSession = (options: AgentSessionOptions) => create<AgentSessionInstance>((set, get) => {
  return createAgentSession(options, get, set, emitter as any);
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




// NOTE: this is preconfigured for the agent starter react app
export const useAgentSession = createUseAgentSession({
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
});

