import { ParticipantEvent, Room, RoomEvent } from 'livekit-client';
import type TypedEventEmitter from 'typed-emitter';
import { EventEmitter } from "events";
import { LocalParticipant, Track } from 'livekit-client';
import { createLocalTrack, LocalTrackInstance } from './LocalTrack';
import { ParticipantPermission } from 'livekit-server-sdk';
import { trackSourceToProtocol } from '../external-deps/components-js';
import { createScopedGetSet } from '../lib/scoped-get-set';

export enum LocalTrackEvent {
  // PendingDisabled = 'pendingDisabled',
};

export type LocalCallbacks = {
  // [LocalTrackEvent.PendingDisabled]: () => void;
};

export type LocalInstance = {
  [Symbol.toStringTag]: "LocalInstance";

  permissions: ParticipantPermission | null;
  publishPermissions: {
    camera: boolean | null;
    microphone: boolean | null;
    screenShare: boolean | null;
    data: boolean;
  };

  camera: LocalTrackInstance<Track.Source.Camera>;
  microphone: LocalTrackInstance<Track.Source.Microphone>;
  screenShare: LocalTrackInstance<Track.Source.ScreenShare>;

  subtle: {
    emitter: TypedEventEmitter<LocalCallbacks>;
    initialize: () => void;
    teardown: () => void;

    localParticipant: LocalParticipant;
  };
};

export function createLocal(
  room: Room,
  get: () => LocalInstance,
  set: (fn: (old: LocalInstance) => LocalInstance) => void,
): LocalInstance {
  const emitter = new EventEmitter() as TypedEventEmitter<LocalCallbacks>;

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
    get().camera.subtle.initialize();
    get().microphone.subtle.initialize();
    get().screenShare.subtle.initialize();

    room.on(RoomEvent.ParticipantPermissionsChanged, handleParticipantPermissionsChanged);
  };

  const teardown = () => {
    room.localParticipant.off(ParticipantEvent.ParticipantPermissionsChanged, handleParticipantPermissionsChanged);

    get().camera.subtle.teardown();
    get().microphone.subtle.teardown();
    get().screenShare.subtle.teardown();
  };

  const { get: trackGet, set: trackSet } = createScopedGetSet(get, set, 'camera', 'LocalTrack');
  const camera = createLocalTrack({
    room,
    trackSource: Track.Source.Camera,
    preventUserChoicesSave: false,
  }, trackGet, trackSet);

  const { get: microphoneTrackGet, set: microphoneTrackSet } = createScopedGetSet(get, set, 'microphone', 'LocalTrack');
  const microphone = createLocalTrack({
    room,
    trackSource: Track.Source.Microphone,
    preventUserChoicesSave: false,
  }, microphoneTrackGet, microphoneTrackSet);

  const { get: screenShareTrackGet, set: screenShareTrackSet } = createScopedGetSet(get, set, 'screenShare', 'LocalTrack');
  const screenShare = createLocalTrack({
    room,
    trackSource: Track.Source.ScreenShare,
    preventUserChoicesSave: false,
  }, screenShareTrackGet, screenShareTrackSet);

  return {
    [Symbol.toStringTag]: "LocalInstance",

    permissions: room.localParticipant.permissions ?? null,
    publishPermissions: {
      camera: null,
      microphone: null,
      screenShare: null,
      data: false,
    },

    camera,
    microphone,
    screenShare,

    subtle: {
      emitter,
      initialize,
      teardown,

      localParticipant: room.localParticipant,
    },
  };
}
