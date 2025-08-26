import { ParticipantEvent, Room, RoomEvent } from 'livekit-client';
import type TypedEventEmitter from 'typed-emitter';
import { EventEmitter } from "events";
import { LocalParticipant, Track } from 'livekit-client';
import { createLocalTrack, LocalTrackInstance } from './LocalTrack';
import { ParticipantPermission } from 'livekit-server-sdk';
import { trackSourceToProtocol } from '../external-deps/components-js';

export enum LocalTrackEvent {
  // PendingDisabled = 'pendingDisabled',
};

export type LocalCallbacks = {
  // [LocalTrackEvent.PendingDisabled]: () => void;
};

const trackSourcesAndKeys = [
  [Track.Source.Camera, 'camera'],
  [Track.Source.Microphone, 'microphone'],
  [Track.Source.ScreenShare, 'screenShare'],
] as Array<[Track.Source, 'camera' | 'microphone' | 'screenShare']>;

export type LocalInstance = {
  [Symbol.toStringTag]: "LocalInstance";

  initialize: () => void;
  teardown: () => void;

  permissions: ParticipantPermission | null;
  publishPermissions: {
    camera: boolean | null;
    microphone: boolean | null;
    screenShare: boolean | null;
    data: boolean;
  };

  camera: LocalTrackInstance<Track.Source.Camera> | null;
  microphone: LocalTrackInstance<Track.Source.Microphone> | null;
  screenShare: LocalTrackInstance<Track.Source.ScreenShare> | null;

  subtle: {
    emitter: TypedEventEmitter<LocalCallbacks>;
    localParticipant: LocalParticipant;
  };
};

export function createLocal(
  room: Room,
  get: () => LocalInstance,
  set: (fn: (old: LocalInstance) => LocalInstance) => void,
  emitter: TypedEventEmitter<LocalCallbacks>,
): LocalInstance {
  const handleParticipantPermissionsChanged = () => {
    const permissions = room.localParticipant.permissions ?? null;

    const canPublishSource = (source: Track.Source) => {
      return (
        permissions?.canPublish &&
        (permissions.canPublishSources.length === 0 ||
          permissions.canPublishSources.includes(trackSourceToProtocol(source)))
      );
    };

    set((old) => ({
      ...old,
      permissions,
      publishPermissions: { // FIXME: figure out a better place to put this? Maybe in with tracks?
        camera: canPublishSource(Track.Source.Camera) ?? null,
        microphone: canPublishSource(Track.Source.Microphone) ?? null,
        screenShare: canPublishSource(Track.Source.ScreenShare) ?? null,
        data: permissions?.canPublishData ?? false,
      },
    }));
    // FIXME: add event?
  };

  const initialize = () => {
    for (const [trackSource, key] of trackSourcesAndKeys) {
      const emitter = new EventEmitter(); // FIXME: can I get rid of this?
      const track = createLocalTrack(
        {
          room,
          trackSource,
          preventUserChoicesSave: false,
        },
        () => get()[key]!, // FIXME: handle null case better
        (fn) => set((old) => ({ ...old, [key]: fn(old[key]!) })),
        emitter as any,
      );
      // track.subtle.emitter.on(AgentEvent.AgentAttributesChanged, handleAgentAttributesChanged);
      set((old) => ({ ...old, [key]: track }));
      track.initialize();
    }

    room.on(RoomEvent.ParticipantPermissionsChanged, handleParticipantPermissionsChanged);
  };

  const teardown = () => {
    for (const [_source, key] of trackSourcesAndKeys) {
      get()[key]?.teardown();
      // get().[source]?.subtle.emitter.off(AgentEvent.AgentAttributesChanged, handleAgentAttributesChanged);
      set((old) => ({ ...old, [key]: null }));
    }

    room.localParticipant.off(ParticipantEvent.ParticipantPermissionsChanged, handleParticipantPermissionsChanged);
  };

  return {
    [Symbol.toStringTag]: "LocalInstance",

    initialize,
    teardown,

    permissions: room.localParticipant.permissions ?? null,
    publishPermissions: {
      camera: null,
      microphone: null,
      screenShare: null,
      data: false,
    },

    camera: null,
    microphone: null,
    screenShare: null,

    subtle: {
      emitter,
      localParticipant: room.localParticipant,
    },
  };
}
