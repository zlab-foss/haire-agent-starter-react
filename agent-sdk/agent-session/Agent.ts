import type TypedEventEmitter from 'typed-emitter';
import { EventEmitter } from "events";
import { ConnectionState, ParticipantEvent, ParticipantKind, RemoteParticipant, Room, RoomEvent, Track } from 'livekit-client';
import { getParticipantTrackRefs, participantTrackEvents, TrackReference } from '@/agent-sdk/external-deps/components-js';
import { ParticipantEventCallbacks } from '@/agent-sdk/external-deps/client-sdk-js';

const stateAttribute = 'lk.agent.state';

export type AgentState =
  | 'disconnected'
  | 'connecting'
  | 'initializing'
  | 'listening'
  | 'thinking'
  | 'speaking';

export enum AgentEvent {
  VideoTrackChanged = 'videoTrackChanged',
  AudioTrackChanged = 'videoTrackChanged',
  AgentAttributesChanged = 'agentAttributesChanged',
  AgentStateChanged = 'agentStateChanged',
}

export type AgentCallbacks = {
  [AgentEvent.VideoTrackChanged]: (newTrack: TrackReference | null) => void;
  [AgentEvent.AudioTrackChanged]: (newTrack: TrackReference | null) => void;
  [AgentEvent.AgentAttributesChanged]: (newAttributes: Record<string, string>) => void;
  [AgentEvent.AgentStateChanged]: (newState: AgentState) => void;
};

/** Encapsulates all agent state / complexity */
export default class Agent extends (EventEmitter as new () => TypedEventEmitter<AgentCallbacks>) {
  private room: Room;
  state: AgentState = 'disconnected';

  private agentParticipant: RemoteParticipant | null = null;
  private workerParticipant: RemoteParticipant | null = null;
  audioTrack: TrackReference | null = null;
  videoTrack: TrackReference | null = null;

  attributes: Record<string, string> = {};

  constructor(room: Room) {
    super();
    this.room = room;

    this.room.on(RoomEvent.ParticipantConnected, this.handleParticipantConnected);
    this.room.on(RoomEvent.ParticipantDisconnected, this.handleParticipantDisconnected);
    this.room.on(RoomEvent.ConnectionStateChanged, this.handleConnectionStateChanged);
    this.updateAgentState();
  }

  teardown() {
    this.room.off(RoomEvent.ParticipantConnected, this.handleParticipantConnected);
    this.room.off(RoomEvent.ParticipantDisconnected, this.handleParticipantDisconnected);
    this.room.off(RoomEvent.ConnectionStateChanged, this.handleConnectionStateChanged);
  }

  private handleParticipantConnected = () => {
    this.updateParticipants();
  }
  private handleParticipantDisconnected = () => {
    this.updateParticipants();
  }

  private handleConnectionStateChanged = () => {
    this.updateAgentState();
  }

  private updateParticipants() {
    const newAgentParticipant = this.roomRemoteParticipants.find(
      (p) => p.kind === ParticipantKind.AGENT && !('lk.publish_on_behalf' in p.attributes),
    ) ?? null;
    const newWorkerParticipant = newAgentParticipant ? (
      this.roomRemoteParticipants.find(
        (p) =>
          p.kind === ParticipantKind.AGENT && p.attributes['lk.publish_on_behalf'] === newAgentParticipant.identity,
      ) ?? null
    ) : null;

    const oldAgentParticipant = this.agentParticipant;
    const oldWorkerParticipant = this.workerParticipant;
    this.agentParticipant = newAgentParticipant;
    this.workerParticipant = newWorkerParticipant;

    // 1. Listen for attribute changes
    if (oldAgentParticipant !== this.agentParticipant) {
      oldAgentParticipant?.off(ParticipantEvent.AttributesChanged, this.handleAttributesChanged);

      if (this.agentParticipant) {
        this.agentParticipant.on(ParticipantEvent.AttributesChanged, this.handleAttributesChanged);
        this.handleAttributesChanged(this.agentParticipant.attributes);
      }
    }

    // 2. Listen for track updates
    for (const event of participantTrackEvents) {
      if (oldAgentParticipant !== this.agentParticipant) {
        oldAgentParticipant?.off(event as keyof ParticipantEventCallbacks, this.handleUpdateTracks);
        if (this.agentParticipant) {
          this.agentParticipant.on(event as keyof ParticipantEventCallbacks, this.handleUpdateTracks);
          this.handleUpdateTracks();
        }
      }
      if (oldWorkerParticipant !== this.workerParticipant) {
        oldWorkerParticipant?.off(event as keyof ParticipantEventCallbacks, this.handleUpdateTracks);
        if (this.workerParticipant) {
          this.workerParticipant.on(event as keyof ParticipantEventCallbacks, this.handleUpdateTracks);
          this.handleUpdateTracks();
        }
      }
    }
  }

  private handleUpdateTracks = () => {
    const newVideoTrack = (
      this.agentTracks.find((t) => t.source === Track.Source.Camera) ??
      this.workerTracks.find((t) => t.source === Track.Source.Camera) ?? null
    );
    if (this.videoTrack !== newVideoTrack) {
      this.videoTrack = newVideoTrack;
      this.emit(AgentEvent.VideoTrackChanged, newVideoTrack);
    }

    const newAudioTrack = (
      this.agentTracks.find((t) => t.source === Track.Source.Microphone) ??
      this.workerTracks.find((t) => t.source === Track.Source.Microphone) ?? null
    );
    if (this.audioTrack !== newAudioTrack) {
      this.audioTrack = newAudioTrack;
      this.emit(AgentEvent.AudioTrackChanged, newAudioTrack);
    }
  };

  private handleAttributesChanged = (attributes: Record<string, string>) => {
    this.attributes = attributes;
    this.emit(AgentEvent.AgentAttributesChanged, attributes);
    this.updateAgentState();
  };

  private updateAgentState() {
    let newAgentState: AgentState | null = null;
    const connectionState = this.room.state;

    if (connectionState === ConnectionState.Disconnected) {
      newAgentState = 'disconnected';
    } else if (
      connectionState === ConnectionState.Connecting ||
      !this.agentParticipant ||
      !this.attributes[stateAttribute]
    ) {
      newAgentState = 'connecting';
    } else {
      newAgentState = this.attributes[stateAttribute] as AgentState;
    }
    console.log('!! STATE:', newAgentState, this.agentParticipant?.attributes);

    if (this.state !== newAgentState) {
      this.state = newAgentState;
      this.emit(AgentEvent.AgentStateChanged, newAgentState);
    }
  }

  private get roomRemoteParticipants() {
    return Array.from(this.room.remoteParticipants.values());
  }

  private get agentTracks() {
    if (!this.agentParticipant) {
      return [];
    }
    return getParticipantTrackRefs(
      this.agentParticipant,
      { sources: [Track.Source.Microphone, Track.Source.Camera] }
    );
  }

  private get workerTracks() {
    if (!this.workerParticipant) {
      return [];
    }
    return getParticipantTrackRefs(
      this.workerParticipant,
      { sources: [Track.Source.Microphone, Track.Source.Camera] }
    );
  }
}
