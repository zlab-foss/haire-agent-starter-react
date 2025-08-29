import { ConnectionState, ParticipantEvent, ParticipantKind, RemoteParticipant, RemoteTrackPublication, Room, RoomEvent, Track } from 'livekit-client';
import type TypedEventEmitter from 'typed-emitter';
import { EventEmitter } from 'stream';
import { getParticipantTrackRefs, participantTrackEvents, roomTrackEvents } from '@/agent-sdk/external-deps/components-js';
import { ParticipantEventCallbacks, RoomEventCallbacks } from '@/agent-sdk/external-deps/client-sdk-js';
import { ParticipantAttributes } from '@/agent-sdk/lib/participant-attributes';
import { createRemoteTrack, RemoteTrackInstance } from './RemoteTrack';

/** State representing the current status of the agent, whether it is ready for speach, etc */
export type AgentConversationalState = 'disconnected' | 'initializing' | 'idle' | 'listening' | 'thinking' | 'speaking';

export enum AgentEvent {
  VideoTrackChanged = 'videoTrackChanged',
  AudioTrackChanged = 'audioTrackChanged',
  AgentAttributesChanged = 'agentAttributesChanged',
  AgentConversationalStateChanged = 'agentConversationalStateChanged',
}

export type AgentCallbacks = {
  [AgentEvent.VideoTrackChanged]: (newTrack: RemoteTrackInstance<Track.Source.Camera> | null) => void;
  [AgentEvent.AudioTrackChanged]: (newTrack: RemoteTrackInstance<Track.Source.Microphone> | null) => void;
  [AgentEvent.AgentAttributesChanged]: (newAttributes: Record<string, string>) => void;
  [AgentEvent.AgentConversationalStateChanged]: (newAgentConversationalState: AgentConversationalState) => void;
};




export type AgentInstance = {
  [Symbol.toStringTag]: "AgentInstance";

  initialize: () => void;
  teardown: () => void;

  conversationalState: AgentConversationalState;

  /** Is the agent ready for user interaction? */
  isAvailable: boolean;

  /** Returns a promise that resolves once the agent is available for interaction */
  waitUntilAvailable: (signal?: AbortSignal) => Promise<void>;

  camera: RemoteTrackInstance<Track.Source.Camera> | null;
  microphone: RemoteTrackInstance<Track.Source.Microphone> | null;

  // FIXME: maybe add some sort of schema to this?
  attributes: Record<string, string>;

  subtle: {
    emitter: TypedEventEmitter<AgentCallbacks>;
    agentParticipant: RemoteParticipant | null;
    workerParticipant: RemoteParticipant | null;
  };
};

/**
  * Agent encapculates all agent state, normalizing some quirks around how LiveKit Agents work.
  */
export function createAgent(
  room: Room,
  get: () => AgentInstance,
  set: (fn: (old: AgentInstance) => AgentInstance) => void,
): AgentInstance {
  const emitter = new EventEmitter() as TypedEventEmitter<AgentCallbacks>;

  const handleParticipantConnected = () => {
    updateParticipants();
  };
  room.on(RoomEvent.ParticipantConnected, handleParticipantConnected);

  const handleParticipantDisconnected = () => {
    updateParticipants();
  };
  room.on(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected);

  const handleConnectionStateChanged = () => {
    updateConversationalState();
  };
  room.on(RoomEvent.ConnectionStateChanged, handleConnectionStateChanged);

  const handleLocalParticipantTrackPublished = () => {
    updateConversationalState();
  };
  room.localParticipant.on(ParticipantEvent.TrackPublished, handleLocalParticipantTrackPublished)

  const initialize = () => {
    updateConversationalState();
  };

  const teardown = () => {
    room.off(RoomEvent.ParticipantConnected, handleParticipantConnected);
    room.off(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected);
    room.off(RoomEvent.ConnectionStateChanged, handleConnectionStateChanged);
    room.localParticipant.off(ParticipantEvent.TrackPublished, handleLocalParticipantTrackPublished)

    get().camera?.teardown();
    get().microphone?.teardown();
    set((old) => ({ ...old, camera: null, microphone: null }));
  };

  const waitUntilAvailable = async (signal?: AbortSignal) => {
    return new Promise<void>((resolve, reject) => {
      const stateChangedHandler = () => {
        if (!get().isAvailable) {
          return;
        }
        cleanup();
        resolve();
      };
      const abortHandler = () => {
        cleanup();
        reject(new Error('AgentInstance.waitUntilAgentIsAvailable - signal aborted'));
      };

      const cleanup = () => {
        emitter.off(AgentEvent.AgentConversationalStateChanged, stateChangedHandler);
        signal?.removeEventListener('abort', abortHandler);
      };

      emitter.on(AgentEvent.AgentConversationalStateChanged, stateChangedHandler);
      signal?.addEventListener('abort', abortHandler);
    });
  };

  const handleAttributesChanged = (attributes: Record<string, string>) => {
    set((old) => ({ ...old, attributes }));
    emitter.emit(AgentEvent.AgentAttributesChanged, attributes);

    updateConversationalState();
  };

  const handleUpdateTracks = () => {
    const {
      camera: oldCamera,
      microphone: oldMicrophone,
      subtle: { agentParticipant, workerParticipant }
    } = get();

    const agentTracks = agentParticipant ? getParticipantTrackRefs(
      agentParticipant,
      { sources: [Track.Source.Microphone, Track.Source.Camera] }
    ) : [];
    const workerTracks = workerParticipant ? getParticipantTrackRefs(
      workerParticipant,
      { sources: [Track.Source.Microphone, Track.Source.Camera] }
    ) : [];

    const newVideoTrack = (
      agentTracks.find((t) => t.source === Track.Source.Camera) ??
      workerTracks.find((t) => t.source === Track.Source.Camera) ?? null
    );
    if (oldCamera?.subtle.publication !== newVideoTrack?.publication) {
      const camera = newVideoTrack ? (
        createRemoteTrack(
          {
            publication: newVideoTrack.publication as RemoteTrackPublication,
            participant: newVideoTrack.participant,
          },
          () => get().camera!,
          (fn: (old: RemoteTrackInstance<Track.Source.Camera>) => RemoteTrackInstance<Track.Source.Camera>) => {
            return set((old) => ({ ...old, camera: fn(old.camera!) }));
          },
        )
      ) : null;
      set((old) => ({ ...old, camera }));
      camera?.initialize();
      emitter.emit(AgentEvent.VideoTrackChanged, camera);
    }

    const newAudioTrack = (
      agentTracks.find((t) => t.source === Track.Source.Microphone) ??
      workerTracks.find((t) => t.source === Track.Source.Microphone) ?? null
    );
    if (oldMicrophone?.subtle.publication !== newAudioTrack?.publication) {
      const microphone = newAudioTrack ? (
        createRemoteTrack(
          {
            publication: newAudioTrack.publication as RemoteTrackPublication,
            participant: newAudioTrack.participant,
          },
          () => get().microphone!,
          (fn: (old: RemoteTrackInstance<Track.Source.Microphone>) => RemoteTrackInstance<Track.Source.Microphone>) => {
            return set((old) => ({ ...old, microphone: fn(old.microphone!) }));
          },
        )
      ) : null;
      set((old) => ({ ...old, microphone }));
      microphone?.initialize();
      emitter.emit(AgentEvent.AudioTrackChanged, microphone);
    }
  };

  const updateParticipants = () => {
    const {
      agentParticipant: oldAgentParticipant,
      workerParticipant: oldWorkerParticipant,
    } = get().subtle;

    const roomRemoteParticipants = Array.from(room.remoteParticipants.values());
    const newAgentParticipant = roomRemoteParticipants.find(
      (p) => p.kind === ParticipantKind.AGENT && !(ParticipantAttributes.publishOnBehalf in p.attributes),
    ) ?? null;
    const newWorkerParticipant = newAgentParticipant ? (
      roomRemoteParticipants.find(
        (p) =>
          p.kind === ParticipantKind.AGENT && p.attributes[ParticipantAttributes.publishOnBehalf] === newAgentParticipant.identity,
      ) ?? null
    ) : null;

    // 1. Listen for attribute changes
    if (oldAgentParticipant !== newAgentParticipant) {
      oldAgentParticipant?.off(ParticipantEvent.AttributesChanged, handleAttributesChanged);

      if (newAgentParticipant) {
        newAgentParticipant.on(ParticipantEvent.AttributesChanged, handleAttributesChanged);
        handleAttributesChanged(newAgentParticipant.attributes);
      }
    }

    // 2. Listen for track updates
    if (oldAgentParticipant !== newAgentParticipant) {
      set((old) => ({ ...old, subtle: { ...old.subtle, agentParticipant: newAgentParticipant } }));

      for (const event of participantTrackEvents) {
        oldAgentParticipant?.off(event as keyof ParticipantEventCallbacks, handleUpdateTracks);
      }
      for (const event of roomTrackEvents) {
        room.off(event as keyof RoomEventCallbacks, handleUpdateTracks);
      }

      if (newAgentParticipant) {
        for (const event of participantTrackEvents) {
          newAgentParticipant.on(event as keyof ParticipantEventCallbacks, handleUpdateTracks);
        }
        for (const event of roomTrackEvents) {
          room.on(event as keyof RoomEventCallbacks, handleUpdateTracks);
        }
        handleUpdateTracks();
      }
    }
    if (oldWorkerParticipant !== newWorkerParticipant) {
      set((old) => ({ ...old, subtle: { ...old.subtle, workerParticipant: newWorkerParticipant } }));

      for (const event of participantTrackEvents) {
        oldWorkerParticipant?.off(event as keyof ParticipantEventCallbacks, handleUpdateTracks);
      }
      for (const event of roomTrackEvents) {
        room.off(event as keyof RoomEventCallbacks, handleUpdateTracks);
      }

      if (newWorkerParticipant) {
        for (const event of participantTrackEvents) {
          newWorkerParticipant.on(event as keyof ParticipantEventCallbacks, handleUpdateTracks);
        }
        for (const event of roomTrackEvents) {
          room.on(event as keyof RoomEventCallbacks, handleUpdateTracks);
        }
        handleUpdateTracks();
      }
    }
  };

  const updateConversationalState = () => {
    let newConversationalState: AgentConversationalState = 'disconnected';
    const { conversationalState, attributes, subtle: { agentParticipant } } = get();

    if (room.state !== ConnectionState.Disconnected) {
      newConversationalState = 'initializing';
    }

    // If the microphone preconnect buffer is active, then the state should be "listening" rather
    // than "initializing"
    const micTrack = room.localParticipant.getTrackPublication(Track.Source.Microphone);
    if (micTrack) {
      newConversationalState = 'listening';
    }

    if (agentParticipant && attributes[ParticipantAttributes.state]) {
      // ref: https://github.com/livekit/agents/blob/65170238db197f62f479eb7aaef1c0e18bfad6e7/livekit-agents/livekit/agents/voice/events.py#L97
      const agentState = attributes[ParticipantAttributes.state] as 'initializing' | 'idle' | 'listening' | 'thinking' | 'speaking';
      newConversationalState = agentState;
    }

    console.log('!! CONVERSATIONAL STATE:', newConversationalState);

    if (conversationalState !== newConversationalState) {
      set((old) => ({
        ...old,
        conversationalState: newConversationalState,
        ...generateDerivedConversationalStateValues(newConversationalState),
      }));
      emitter.emit(AgentEvent.AgentConversationalStateChanged, newConversationalState);
    }
  };
  const generateDerivedConversationalStateValues = (conversationalState: AgentInstance["conversationalState"]) => ({
    isAvailable: (
      conversationalState === 'listening' ||
      conversationalState === 'thinking' ||
      conversationalState === 'speaking'
    ),
  });

  return {
    [Symbol.toStringTag]: "AgentInstance",

    initialize,
    teardown,

    conversationalState: 'disconnected',
    ...generateDerivedConversationalStateValues('disconnected'),

    waitUntilAvailable,

    microphone: null,
    camera: null,

    attributes: {},

    subtle: {
      emitter,
      agentParticipant: null,
      workerParticipant: null,
    },
  };
}
