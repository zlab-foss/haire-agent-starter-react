import { Participant, RemoteAudioTrack, RemoteTrackPublication, Track } from 'livekit-client';
import { participantEvents } from './LocalTrack';

export type RemoteTrackInstance<TrackSource extends Track.Source> = {
  [Symbol.toStringTag]: "RemoteTrackInstance";
  isLocal: false,

  /** Given a media element, properly plumb the media stream through to it so media can be shown / heard in the app. */
  attachToMediaElement: (element: TrackSource extends Track.Source.Microphone | Track.Source.ScreenShareAudio ? HTMLAudioElement : HTMLVideoElement) => () => void;

  setSubscribed: (subscribed: boolean) => void;
  waitUntilSubscribed: (signal?: AbortSignal) => Promise<void>;
  setEnabled: (enabled: boolean) => void;
  setVolume: (volume: number) => void;

  /** The type of track reprsented (ie, camera, microphone, screen share, etc) */
  source: TrackSource;

  /** Is the track currently enabled? */
  enabled: boolean;

  /** Is the track currently muted? */
  muted: boolean;

  /** Is the app currently receiving data from the SFU for this track? */
  subscribed: boolean;

  dimensions: Track.Dimensions | null;
  orientation: 'landscape' | 'portrait' | null;

  subtle: {
    initialize: () => void;
    teardown: () => void;
    publication: RemoteTrackPublication,
  };
};

export function createRemoteTrack<TrackSource extends Track.Source>(
  options: { participant: Participant, publication: RemoteTrackPublication},
  get: () => RemoteTrackInstance<TrackSource>,
  set: (fn: (old: RemoteTrackInstance<TrackSource>) => RemoteTrackInstance<TrackSource>) => void,
): RemoteTrackInstance<TrackSource> {
  const attachToMediaElement = (element: HTMLMediaElement) => {
    const track = get().subtle.publication.track;
    if (!track) {
      throw new Error('RemoteTrackInstance.attachToMediaElement - track not set');
    }

    track.attach(element);
    return () => {
      track.detach(element);
    };
  };

  const setSubscribed = (subscribed: boolean) => {
    options.publication.setSubscribed(subscribed)
  };

  const waitUntilSubscribed = async (signal?: AbortSignal) => {
    const publication = get().subtle.publication;
    if (publication.isSubscribed) {
      return;
    }

    return new Promise<void>((resolve, reject) => {
      const subscribedChangedHandler = () => {
        if (!publication.isSubscribed) {
          return;
        }
        cleanup();
        resolve();
      };
      const abortHandler = () => {
        cleanup();
        reject(new Error('RemoteTrack.waitUntilSubscribed - signal aborted'));
      };

      const cleanup = () => {
        publication.off("subscribed", subscribedChangedHandler);
        signal?.removeEventListener('abort', abortHandler);
      };

      publication.on("subscribed", subscribedChangedHandler);
      signal?.addEventListener('abort', abortHandler);
    });
  };

  const setEnabled = (enabled: boolean) => {
    // FIXME: add warning for other side of if?
    if (options.publication instanceof RemoteTrackPublication) {
      options.publication.setEnabled(enabled)
    }
  };

  const setVolume = (volume: number) => {
    // FIXME: add warning for other side of if?
    if (options.publication instanceof RemoteTrackPublication && options.publication.track instanceof RemoteAudioTrack) {
      options.publication.track.setVolume(volume);
    }
  };

  const handleParticipantEvent = () => {
    let enabled = false;
    switch (options.publication.source) {
      case Track.Source.Camera:
        enabled = options.participant.isCameraEnabled;
        break;
      case Track.Source.Microphone:
        enabled = options.participant.isMicrophoneEnabled;
        break;
      case Track.Source.ScreenShare:
        enabled = options.participant.isScreenShareEnabled;
        break;
      default:
        throw new Error(`RemoteTrackInstance.handleParticipantEvent - Unable to handle processing track source ${options.publication.source}.`);
    }

    let orientation = null;
    // Set the orientation of the video track.
    // TODO: This does not handle changes in orientation after a track got published (e.g when rotating a phone camera from portrait to landscape).
    if (
      typeof options.publication.dimensions?.width === 'number' &&
      typeof options.publication.dimensions?.height === 'number'
    ) {
      orientation =
        options.publication.dimensions.width > options.publication.dimensions.height ? 'landscape' as const : 'portrait' as const;
    }

    set((old) => ({
      ...old,
      enabled,
      muted: options.publication.isMuted,
      dimensions: options.publication.dimensions ?? null,
      subscribed: options.publication.isSubscribed,
      orientation,
    }));
  };
  for (const eventname of participantEvents) {
    options.participant.off(eventname, handleParticipantEvent);
  }

  const initialize = () => {
    handleParticipantEvent();
  };

  const teardown = () => {
    for (const eventname of participantEvents) {
      options.participant.off(eventname, handleParticipantEvent);
    };
  };

  return {
    [Symbol.toStringTag]: "RemoteTrackInstance",
    isLocal: false,

    attachToMediaElement,

    setSubscribed,
    waitUntilSubscribed,
    setEnabled,
    setVolume,

    source: options.publication.source as TrackSource,
    enabled: false,
    muted: false,
    subscribed: false,
    dimensions: null,
    orientation: null,

    subtle: {
      initialize,
      teardown,

      publication: options.publication,
    },
  };
}
