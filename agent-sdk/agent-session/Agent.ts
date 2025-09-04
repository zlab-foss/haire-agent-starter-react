import { ConnectionState, ParticipantEvent, ParticipantKind, RemoteParticipant, RemoteTrackPublication, Room, RoomEvent, Track } from 'livekit-client';
import type TypedEventEmitter from 'typed-emitter';
import { EventEmitter } from 'events';
import { getParticipantTrackRefs, participantTrackEvents, roomTrackEvents } from '@/agent-sdk/external-deps/components-js';
import { ParticipantEventCallbacks, RoomEventCallbacks } from '@/agent-sdk/external-deps/client-sdk-js';
import { ParticipantAttributes } from '@/agent-sdk/lib/participant-attributes';
import { createRemoteTrack, RemoteTrackInstance } from './RemoteTrack';
import { createScopedGetSet } from '../lib/scoped-get-set';

/** State representing the current status of the agent, whether it is ready for speach, etc */
export type AgentConversationalState = 'disconnected' | 'initializing' | 'idle' | 'listening' | 'thinking' | 'speaking';

export enum AgentEvent {
  CameraChanged = 'cameraChanged',
  MicrophoneChanged = 'microphoneChanged',
  AttributesChanged = 'attributesChanged',
  ConversationalStateChanged = 'conversationalStateChanged',
}

export type AgentCallbacks = {
  [AgentEvent.CameraChanged]: (newTrack: RemoteTrackInstance<Track.Source.Camera> | null) => void;
  [AgentEvent.MicrophoneChanged]: (newTrack: RemoteTrackInstance<Track.Source.Microphone> | null) => void;
  [AgentEvent.AttributesChanged]: (newAttributes: Record<string, string>) => void;
  [AgentEvent.ConversationalStateChanged]: (newAgentConversationalState: AgentConversationalState) => void;
};



type AgentInstanceCommon = {
  [Symbol.toStringTag]: "AgentInstance";

  /** Returns a promise that resolves once the agent is available for interaction */
  waitUntilAvailable: (signal?: AbortSignal) => Promise<void>;

  /** Returns a promise that resolves once the agent has published a camera track */
  waitUntilCamera: (signal?: AbortSignal) => Promise<void>;

  /** Returns a promise that resolves once the agent has published a microphone track */
  waitUntilMicrophone: (signal?: AbortSignal) => Promise<void>;

  // FIXME: maybe add some sort of schema to this?
  attributes: Record<string, string>;

  subtle: {
    emitter: TypedEventEmitter<AgentCallbacks>;
    initialize: () => void;
    teardown: () => void;

    agentParticipant: RemoteParticipant | null;
    workerParticipant: RemoteParticipant | null;
  };
};

type AgentInstanceAvailable = AgentInstanceCommon & {
  conversationalState: "listening" | "thinking" | "speaking";

  /** Is the agent ready for user interaction? */
  isAvailable: true;

  camera: RemoteTrackInstance<Track.Source.Camera> | null;
  microphone: RemoteTrackInstance<Track.Source.Microphone> | null;
};

type AgentInstanceUnAvailable = AgentInstanceCommon & {
  conversationalState: "disconnected" | "initializing" | "idle";

  /** Is the agent ready for user interaction? */
  isAvailable: false;

  camera: null;
  microphone: null;
};

export type AgentInstance = AgentInstanceAvailable | AgentInstanceUnAvailable;

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

  const handleParticipantDisconnected = () => {
    updateParticipants();
  };

  const handleConnectionStateChanged = () => {
    set((old) => generateConversationalStateUpdate(old, old.camera, old.microphone));
  };

  const handleLocalParticipantTrackPublished = () => {
    set((old) => generateConversationalStateUpdate(old, old.camera, old.microphone));
  };

  const initialize = () => {
    set((old) => generateConversationalStateUpdate(old, old.camera, old.microphone));

    updateParticipants();

    room.on(RoomEvent.ParticipantConnected, handleParticipantConnected);
    room.on(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected);
    room.on(RoomEvent.ConnectionStateChanged, handleConnectionStateChanged);
    room.localParticipant.on(ParticipantEvent.TrackPublished, handleLocalParticipantTrackPublished)
  };

  const teardown = () => {
    room.localParticipant.off(ParticipantEvent.TrackPublished, handleLocalParticipantTrackPublished)
    room.off(RoomEvent.ConnectionStateChanged, handleConnectionStateChanged);
    room.off(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected);
    room.off(RoomEvent.ParticipantConnected, handleParticipantConnected);

    updateParticipants(); // Detaches any participant related event handlers

    get().camera?.subtle.teardown();
    get().microphone?.subtle.teardown();
    set((old) => generateConversationalStateUpdate(old, null, null));
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
        emitter.off(AgentEvent.ConversationalStateChanged, stateChangedHandler);
        signal?.removeEventListener('abort', abortHandler);
      };

      emitter.on(AgentEvent.ConversationalStateChanged, stateChangedHandler);
      signal?.addEventListener('abort', abortHandler);
    });
  };

  const waitUntilMediaTrack = async (trackType: 'camera' | 'microphone', signal?: AbortSignal) => {
    return new Promise<void>((resolve, reject) => {
      const stateChangedHandler = () => {
        if (!get()[trackType]) {
          return;
        }
        cleanup();
        resolve();
      };
      const abortHandler = () => {
        cleanup();
        reject(new Error('AgentInstance.waitUntilMediaTrack - signal aborted'));
      };

      const cleanup = () => {
        switch (trackType) {
          case 'camera':
            emitter.off(AgentEvent.CameraChanged, stateChangedHandler);
            break;
          case 'microphone':
            emitter.off(AgentEvent.MicrophoneChanged, stateChangedHandler);
            break;
        }
        signal?.removeEventListener('abort', abortHandler);
      };

      switch (trackType) {
        case 'camera':
          emitter.on(AgentEvent.CameraChanged, stateChangedHandler);
          break;
        case 'microphone':
          emitter.on(AgentEvent.MicrophoneChanged, stateChangedHandler);
          break;
      }
      signal?.addEventListener('abort', abortHandler);
    });
  };
  const waitUntilCamera = (signal?: AbortSignal) => waitUntilMediaTrack('camera', signal);
  const waitUntilMicrophone = (signal?: AbortSignal) => waitUntilMediaTrack('microphone', signal);

  const handleAttributesChanged = (attributes: Record<string, string>) => {
    set((old) => ({ ...old, attributes }));
    emitter.emit(AgentEvent.AttributesChanged, attributes);

    set((old) => generateConversationalStateUpdate(old, old.camera, old.microphone));
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

    let camera = oldCamera;
    if (oldCamera?.subtle.publication !== newVideoTrack?.publication) {
      if (newVideoTrack) {
        const { get: cameraGet, set: cameraSet } = createScopedGetSet(get, set, 'camera', 'Agent');
        camera = createRemoteTrack({
          publication: newVideoTrack.publication as RemoteTrackPublication,
          participant: newVideoTrack.participant,
        }, cameraGet, cameraSet);
      } else {
        camera = null;
      }
    }
    if (camera !== oldCamera) {
      emitter.emit(AgentEvent.CameraChanged, camera);
    }

    const newAudioTrack = (
      agentTracks.find((t) => t.source === Track.Source.Microphone) ??
      workerTracks.find((t) => t.source === Track.Source.Microphone) ?? null
    );
    let microphone = oldMicrophone;
    if (oldMicrophone?.subtle.publication !== newAudioTrack?.publication) {
      if (newAudioTrack) {
        const { get: microphoneGet, set: microphoneSet } = createScopedGetSet(get, set, 'microphone', 'Agent');
        microphone = createRemoteTrack({
          publication: newAudioTrack.publication as RemoteTrackPublication,
          participant: newAudioTrack.participant,
        }, microphoneGet, microphoneSet);
      } else {
        microphone = null;
      }
    }
    if (microphone !== oldMicrophone) {
      emitter.emit(AgentEvent.MicrophoneChanged, microphone);
    }

    set((old) => generateConversationalStateUpdate(old, camera, microphone));

    if (camera !== oldCamera) {
      camera?.subtle.initialize();
    }
    if (microphone !== oldMicrophone) {
      microphone?.subtle.initialize();
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

  const generateConversationalState = (attributes: Record<string, string>, agentParticipant: RemoteParticipant | null): AgentConversationalState => {
    let newConversationalState: AgentConversationalState = 'disconnected';

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

    return newConversationalState;
  };
  const generateDerivedConversationalStateValues = <ConversationalState extends AgentConversationalState>(conversationalState: ConversationalState) => ({
    isAvailable: (
      conversationalState === 'listening' ||
      conversationalState === 'thinking' ||
      conversationalState === 'speaking'
    ),
  } as {
    isAvailable: ConversationalState extends 'listening' | 'thinking' | 'speaking' ? true : false,
  });

  const generateConversationalStateUpdate = (
    old: AgentInstance,
    camera: RemoteTrackInstance<Track.Source.Camera> | null,
    microphone: RemoteTrackInstance<Track.Source.Microphone> | null,
  ): AgentInstance => {
    const newConversationalState = generateConversationalState(old.attributes, old.subtle.agentParticipant);

    if (old.conversationalState !== newConversationalState) {
      emitter.emit(AgentEvent.ConversationalStateChanged, newConversationalState);
    }
    switch (newConversationalState) {
      case 'listening':
      case 'thinking':
      case 'speaking':
        // if (camera || !microphone) {
        //   throw new Error(`AgentInstance.generateConversationalStateUpdate - attempted to transition to conversational state ${newConversationalState}, but camera / microphone not found.`);
        // }
        if (old.conversationalState === newConversationalState && old.camera === camera && old.microphone === microphone) {
          return old;
        }

        return {
          ...old,

          conversationalState: newConversationalState,
          ...generateDerivedConversationalStateValues(newConversationalState),

          camera,
          microphone,
        };

      case 'disconnected':
      case 'initializing':
      case 'idle':
        if (old.conversationalState === newConversationalState) {
          return old;
        }
        return {
          ...old,

          conversationalState: newConversationalState,
          ...generateDerivedConversationalStateValues(newConversationalState),

          // Clear inner values if no longer connected
          camera: null,
          microphone: null,
        };
    }
  };

  return {
    [Symbol.toStringTag]: "AgentInstance",

    conversationalState: 'disconnected',
    ...generateDerivedConversationalStateValues('disconnected'),

    waitUntilAvailable,
    waitUntilCamera,
    waitUntilMicrophone,

    microphone: null,
    camera: null,

    attributes: {},

    subtle: {
      emitter,
      initialize,
      teardown,

      agentParticipant: null,
      workerParticipant: null,
    },
  };
}
