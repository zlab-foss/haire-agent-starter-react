import { LocalTrack, Room } from 'livekit-client';
import type TypedEventEmitter from 'typed-emitter';
import { AudioCaptureOptions, LocalTrackPublication, ParticipantEvent, ScreenShareCaptureOptions, Track, TrackPublishOptions, VideoCaptureOptions } from 'livekit-client';
import { ParticipantEventCallbacks } from '@/agent-sdk/external-deps/client-sdk-js';
import { LocalUserChoices } from '@livekit/components-react';
import { SwitchActiveDeviceOptions } from './AgentSession';
import { loadUserChoices, saveUserChoices } from '../external-deps/components-js';

// FIXME: rename this
export const participantEvents: Array<keyof ParticipantEventCallbacks> = [
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
];

type CaptureOptions<TrackSource extends Track.Source> =
  | (TrackSource extends Track.Source.Microphone ? AudioCaptureOptions : never)
  | (TrackSource extends Track.Source.Camera ? VideoCaptureOptions : never)
  | (TrackSource extends Track.Source.ScreenShare ? ScreenShareCaptureOptions : never);

export enum LocalTrackEvent {
  DeviceError = 'deviceError',
  PendingDisabled = 'pendingDisabled',
  DeviceListError = 'deviceListError',
  ActiveDeviceChangeError = 'activeDeviceChangeError',
};

export type LocalTrackCallbacks<TrackSource extends Track.Source> = {
  [LocalTrackEvent.DeviceError]: (error: Error, source: TrackSource) => void;
  [LocalTrackEvent.PendingDisabled]: () => void;
  [LocalTrackEvent.DeviceListError]: (error: Error, source: TrackSource) => void;
  [LocalTrackEvent.ActiveDeviceChangeError]: (error: Error, source: TrackSource) => void;
};

export type LocalTrackInstance<TrackSource extends Track.Source> = {
  [Symbol.toStringTag]: "LocalTrackInstance";

  teardown: () => void;

  /** The type of track reprsented (ie, camera, microphone, screen share, etc) */
  source: TrackSource;

  /** Is the track currently enabled? */
  enabled: boolean;

  /** Is the track currently in the midst of being enabled or disabled? */
  pending: boolean;

  /** Returns a promise which resolves once the track is no longer pending. */
  waitUntilNotPending: (signal?: AbortSignal) => void;

  set: (enabled: boolean, captureOptions?: CaptureOptions<TrackSource>, publishOptions?: TrackPublishOptions) => Promise<boolean>;
  toggle: (captureOptions?: CaptureOptions<TrackSource>, publishOptions?: TrackPublishOptions) => Promise<boolean>;
  devices: {
    activeId: string | null;
    changeActive: (deviceId?: string) => void;
    list: Array<MediaDeviceInfo>;
    subtle: {
      listDevices: (requestPermissions?: boolean) => Promise<Array<MediaDeviceInfo>>,
    },
  },

  subtle: {
    emitter: TypedEventEmitter<LocalTrackCallbacks<TrackSource>>,
    publication: LocalTrackPublication | null,
    userChoices: LocalUserChoices,
  };
};

export function createLocalTrack<TrackSource extends Track.Source>(
  options: {
    room: Room;
    trackSource: TrackSource;
    preventUserChoicesSave: boolean;
  },
  get: () => LocalTrackInstance<TrackSource>,
  set: (fn: (old: LocalTrackInstance<TrackSource>) => LocalTrackInstance<TrackSource>) => void,
  emitter: TypedEventEmitter<LocalTrackCallbacks<TrackSource>>,
): LocalTrackInstance<TrackSource> {
  let mediaDeviceKind = null;
  switch (options.trackSource) {
    case Track.Source.Camera:
      mediaDeviceKind = 'videoinput' as const;
      break;
    case Track.Source.Microphone:
      mediaDeviceKind = 'audioinput' as const;
      break;
  }

  const handleParticipantEvent = () => {
    // FIXME: is the rest of this stuff needed?
    // const { isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled } = p;
    const publication = options.room.localParticipant.getTrackPublication(options.trackSource);
    
    let enabled = false;
    switch (options.trackSource) {
      case Track.Source.Camera:
        enabled = options.room.localParticipant.isCameraEnabled;
        break;
      case Track.Source.Microphone:
        enabled = options.room.localParticipant.isMicrophoneEnabled;
        break;
      case Track.Source.ScreenShare:
        enabled = options.room.localParticipant.isScreenShareEnabled;
        break;
      default:
        throw new Error(`LocalTrackInstance.handleParticipantEvent - Unable to handle processing track source ${options.trackSource}.`);
    }

    set((old) => ({
      ...old,
      enabled,
      subtle: {
        ...old.subtle,
        publication: publication ?? null,
      },
    }));
  };
  for (const eventName of participantEvents) {
    options.room.localParticipant.on(eventName, handleParticipantEvent);
  }

  const teardown = () => {
    for (const eventName of participantEvents) {
      options.room.localParticipant.off(eventName, handleParticipantEvent);
    }

    if (mediaDeviceKind !== null) {
      navigator?.mediaDevices?.removeEventListener('devicechange', handleDeviceChange);
    }
  };

  const setEnabled = async (
    enabled: boolean,
    captureOptions?: CaptureOptions<TrackSource>,
    publishOptions?: TrackPublishOptions,
  ) => {
    await waitUntilNotPending();

    set((old) => ({ ...old, pending: true }));

    let setEnabledPromise;
    let getterKey;
    switch (options.trackSource) {
      case Track.Source.Camera:
        setEnabledPromise = options.room.localParticipant.setCameraEnabled(
          enabled,
          captureOptions as CaptureOptions<Track.Source.Camera>,
          publishOptions,
        );
        getterKey = 'isCameraEnabled' as const;
        break;
      case Track.Source.Microphone:
        setEnabledPromise = options.room.localParticipant.setMicrophoneEnabled(
          enabled,
          captureOptions as CaptureOptions<Track.Source.Microphone>,
          publishOptions,
        );
        getterKey = 'isMicrophoneEnabled' as const;
        break;
      case Track.Source.ScreenShare:
        setEnabledPromise = options.room.localParticipant.setScreenShareEnabled(
          enabled,
          captureOptions as CaptureOptions<Track.Source.ScreenShare>,
          publishOptions,
        );
        getterKey = 'isScreenShareEnabled' as const;
        break;
      default:
        throw new Error(`LocalTrackInstance.setEnabled - Unable to handle enabling track source ${options.trackSource}.`);
    }

    try {
      await setEnabledPromise;
    } catch (err) {
      if (err instanceof Error) {
        emitter.emit(LocalTrackEvent.DeviceError, err, options.trackSource);
      }
      throw err;
    } finally {
      set((old) => ({ ...old, pending: false }));
    }

    switch (options.trackSource) {
      case Track.Source.Camera:
        updateUserChoices('videoEnabled', enabled);
        break;
      case Track.Source.Microphone:
        updateUserChoices('audioEnabled', enabled);
        break;
    }

    set((old) => ({ ...old, enabled })); // FIXME: is this needed given the event handler should fire?

    emitter.emit(LocalTrackEvent.PendingDisabled);
    return options.room.localParticipant[getterKey];
  };

  const toggleEnabled = (captureOptions?: CaptureOptions<TrackSource>, publishOptions?: TrackPublishOptions) => {
    return setEnabled(!get().enabled, captureOptions, publishOptions);
  };

  const updateUserChoices = <Key extends keyof LocalUserChoices>(key: Key, value: LocalUserChoices[Key]) => {
    set((old) => ({
      ...old,
      subtle: {
        ...old.subtle,
        userChoices: {
          ...old.subtle.userChoices,
          [key]: value,
        },
      },
    }));
    saveUserChoices(get().subtle.userChoices, options.preventUserChoicesSave);
  };

  const changeActiveDevice = async (
    id: string = 'default',
    changeActiveDeviceOptions: SwitchActiveDeviceOptions = {},
  ) => {
    if (!mediaDeviceKind) {
      throw new Error(`LocalTrackInstance.devices.change - Unable to change active device for track source ${options.trackSource}.`);
    }

    let userChoicesKey;
    switch (options.trackSource) {
      case Track.Source.Camera:
        userChoicesKey = 'videoDeviceId' as const;
        break;
      case Track.Source.Microphone:
        userChoicesKey = 'audioDeviceId' as const;
        break;
      default:
        throw new Error(`LocalTrackInstance.devices.change - Unable to change active device for track source ${options.trackSource}.`);
    }

    // FIXME: use actual logger of some sort?
    console.debug(`Switching active device of kind "${mediaDeviceKind}" with id ${id}.`);

    // FIXME: is there a way to do this that doesn't require reaching all the way back to the room?
    try {
      await options.room.switchActiveDevice(mediaDeviceKind, id, changeActiveDeviceOptions?.exact);
    } catch (err) {
      if (err instanceof Error) {
        emitter.emit(LocalTrackEvent.ActiveDeviceChangeError, err, options.trackSource);
      }
      throw err;
    }

    const actualDeviceId: string | undefined = options.room.getActiveDevice(mediaDeviceKind) ?? id;
    if (actualDeviceId !== id && id !== 'default') {
      // FIXME: use actual logger of some sort?
      console.info(
        `We tried to select the device with id (${id}), but the browser decided to select the device with id (${actualDeviceId}) instead.`,
      );
    }

    let targetTrack: LocalTrack | undefined = undefined;
    if (mediaDeviceKind === 'audioinput') {
      targetTrack = options.room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track;
    } else if (mediaDeviceKind === 'videoinput') {
      targetTrack = options.room.localParticipant.getTrackPublication(Track.Source.Camera)?.track;
    }

    const useDefault =
      (id === 'default' && !targetTrack) ||
      (id === 'default' && targetTrack?.mediaStreamTrack.label.startsWith('Default'));

    let newCurrentDeviceId = useDefault ? id : actualDeviceId;
    if (newCurrentDeviceId) {
      set((old) => ({
        ...old,
        devices: {
          ...old.devices,
          activeId: newCurrentDeviceId,
        },
      }));
      updateUserChoices(userChoicesKey, id);
    }
    return newCurrentDeviceId;
  };

  const listDevices = (requestPermissions = true) => {
    if (!mediaDeviceKind) {
      throw new Error(`LocalTrackInstance.devices.list - Unable to list devices for track source ${options.trackSource}.`);
    }

    return Room.getLocalDevices(mediaDeviceKind, requestPermissions);
  };

  const handleDeviceChange = async () => {
    let list;
    try {
      list = await listDevices();
    } catch (err) {
      if (err instanceof Error) {
        emitter.emit(LocalTrackEvent.DeviceListError, err, options.trackSource);
      }
      throw err;
    }

    set((old) => ({ ...old, devices: { ...old.devices, list } }));
  };

  if (mediaDeviceKind !== null && typeof window !== 'undefined') {
    handleDeviceChange();
    if (!window.isSecureContext) {
      throw new Error(
        `Accessing media devices is available only in secure contexts (HTTPS and localhost), in some or all supporting browsers. See: https://developer.mozilla.org/en-US/docs/Web/API/Navigator/mediaDevices`,
      );
    }
    navigator?.mediaDevices?.addEventListener('devicechange', handleDeviceChange);
  }

  const waitUntilNotPending = async (signal?: AbortSignal) => {
    const { pending } = get();
    if (!pending) {
      return;
    }

    return new Promise<void>((resolve, reject) => {
      const onceEventOccurred = () => {
        cleanup();
        resolve();
      };
      const abortHandler = () => {
        cleanup();
        reject(new Error(`LocalTrackEvent.waitUntilNotPending - signal aborted`));
      };

      const cleanup = () => {
        emitter.off(LocalTrackEvent.PendingDisabled, onceEventOccurred);
        signal?.removeEventListener('abort', abortHandler);
      };

      emitter.on(LocalTrackEvent.PendingDisabled, onceEventOccurred);
      signal?.addEventListener('abort', abortHandler);
    });
  };

  return {
    [Symbol.toStringTag]: "LocalTrackInstance",

    teardown,

    source: options.trackSource,
    enabled: false,
    pending: false,
    waitUntilNotPending,

    set: setEnabled,
    toggle: toggleEnabled,
    devices: {
      activeId: mediaDeviceKind ? (
        options.room.getActiveDevice(mediaDeviceKind) ?? 'default'
      ) : null,
      changeActive: changeActiveDevice,
      list: [],
      subtle: { listDevices },
    },

    subtle: {
      emitter,
      publication: null,
      userChoices: loadUserChoices(),
    },
  };
}
