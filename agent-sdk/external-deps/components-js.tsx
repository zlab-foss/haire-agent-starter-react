import { Participant, ParticipantEvent, Track, TrackPublication, TranscriptionSegment } from "livekit-client";

// This file contains pieces copied and pasted from the components-js repository
// Something is messed up with my local development environment and I can't figure out how to import
// these properly
//
// FIXME: figure out what is going on here or explicitly vendor this stuff into the agents sdk

/** @public */
export type TrackReference = {
  participant: Participant;
  publication: TrackPublication;
  source: Track.Source;
};

export const participantTrackEvents = [
  ParticipantEvent.TrackPublished,
  ParticipantEvent.TrackUnpublished,
  ParticipantEvent.TrackMuted,
  ParticipantEvent.TrackUnmuted,
  ParticipantEvent.TrackStreamStateChanged,
  ParticipantEvent.TrackSubscribed,
  ParticipantEvent.TrackUnsubscribed,
  ParticipantEvent.TrackSubscriptionPermissionChanged,
  ParticipantEvent.TrackSubscriptionFailed,
  ParticipantEvent.LocalTrackPublished,
  ParticipantEvent.LocalTrackUnpublished,
];

export type ReceivedTranscriptionSegment = TranscriptionSegment & {
  receivedAtMediaTimestamp: number;
  receivedAt: number;
};

export function addMediaTimestampToTranscription(
  segment: TranscriptionSegment,
  timestamps: { timestamp: number; rtpTimestamp?: number },
): ReceivedTranscriptionSegment {
  return {
    ...segment,
    receivedAtMediaTimestamp: timestamps.rtpTimestamp ?? 0,
    receivedAt: timestamps.timestamp,
  };
}

/**
 * @returns An array of unique (by id) `TranscriptionSegment`s. Latest wins. If the resulting array would be longer than `windowSize`, the array will be reduced to `windowSize` length
 */
export function dedupeSegments<T extends TranscriptionSegment>(
  prevSegments: T[],
  newSegments: T[],
  windowSize: number,
) {
  return [...prevSegments, ...newSegments]
    .reduceRight((acc, segment) => {
      if (!acc.find((val) => val.id === segment.id)) {
        acc.unshift(segment);
      }
      return acc;
    }, [] as Array<T>)
    .slice(0 - windowSize);
}

/**
 * Create `TrackReferences` for all tracks that are included in the sources property.
 *  */
export function getParticipantTrackRefs(
  participant: Participant,
  identifier: any/* ParticipantTrackIdentifier */,
  onlySubscribedTracks = false,
): TrackReference[] {
  const { sources, kind, name } = identifier;
  const sourceReferences = Array.from(participant.trackPublications.values())
    .filter(
      (pub) =>
        (!sources || sources.includes(pub.source)) &&
        (!kind || pub.kind === kind) &&
        (!name || pub.trackName === name) &&
        // either return all or only the ones that are subscribed
        (!onlySubscribedTracks || pub.track),
    )
    .map((track): TrackReference => {
      return {
        participant: participant,
        publication: track,
        source: track.source,
      };
    });

  return sourceReferences;
}

export interface TextStreamData {
  text: string;
  participantInfo: { identity: string }; // Replace with the correct type from livekit-client
  streamInfo: any /* TextStreamInfo */;
}

export const DataTopic = {
  CHAT: 'lk.chat',
  TRANSCRIPTION: 'lk.transcription',
} as const;

export const trackSourceToProtocol = (source: Track.Source) => {
  // NOTE: this mapping avoids importing the protocol package as that leads to a significant bundle size increase
  switch (source) {
    case Track.Source.Camera:
      return 1;
    case Track.Source.Microphone:
      return 2;
    case Track.Source.ScreenShare:
      return 3;
    default:
      return 0;
  }
};

const cssPrefix = 'lk';

type JsonPrimitive = string | number | boolean | null;
type JsonArray = JsonValue[];
type JsonObject = { [key: string]: JsonValue };
type JsonValue = JsonPrimitive | JsonArray | JsonObject;

/**
 * Persists a serializable object to local storage associated with the specified key.
 * @internal
 */
function saveToLocalStorage<T extends JsonValue>(key: string, value: T): void {
  if (typeof localStorage === 'undefined') {
    console.error('Local storage is not available.');
    return;
  }

  try {
    if (value) {
      const nonEmptySettings = Object.fromEntries(
        Object.entries(value).filter(([, value]) => value !== ''),
      );
      localStorage.setItem(key, JSON.stringify(nonEmptySettings));
    }
  } catch (error) {
    console.error(`Error setting item to local storage: ${error}`);
  }
}

/**
 * Retrieves a serializable object from local storage by its key.
 * @internal
 */
function loadFromLocalStorage<T extends JsonValue>(key: string): T | undefined {
  if (typeof localStorage === 'undefined') {
    console.error('Local storage is not available.');
    return undefined;
  }

  try {
    const item = localStorage.getItem(key);
    if (!item) {
      console.warn(`Item with key ${key} does not exist in local storage.`);
      return undefined;
    }
    return JSON.parse(item);
  } catch (error) {
    console.error(`Error getting item from local storage: ${error}`);
    return undefined;
  }
}

/**
 * Generate a pair of functions to load and save a value of type T to local storage.
 * @internal
 */
export function createLocalStorageInterface<T extends JsonValue>(
  key: string,
): { load: () => T | undefined; save: (value: T) => void } {
  return {
    load: () => loadFromLocalStorage<T>(key),
    save: (value: T) => saveToLocalStorage<T>(key, value),
  };
}

const USER_CHOICES_KEY = `${cssPrefix}-user-choices` as const;

/**
 * @public
 * Represents the user's choices for video and audio input devices,
 * as well as their username.
 */
export type LocalUserChoices = {
  /**
   * Whether video input is enabled.
   * @defaultValue `true`
   */
  videoEnabled: boolean;
  /**
   * Whether audio input is enabled.
   * @defaultValue `true`
   */
  audioEnabled: boolean;
  /**
   * The device ID of the video input device to use.
   * @defaultValue `''`
   */
  videoDeviceId: string;
  /**
   * The device ID of the audio input device to use.
   * @defaultValue `''`
   */
  audioDeviceId: string;
  /**
   * The username to use.
   * @defaultValue `''`
   */
  username: string;
};

export const defaultUserChoices: LocalUserChoices = {
  videoEnabled: true,
  audioEnabled: true,
  videoDeviceId: 'default',
  audioDeviceId: 'default',
  username: '',
} as const;

/**
 * The type of the object stored in local storage.
 * @remarks
 * TODO: Replace this type with `LocalUserChoices` after removing the deprecated properties from `LocalUserChoices`.
 * @internal
 */
type TempStorageType = Omit<LocalUserChoices, 'e2ee' | 'sharedPassphrase'>;
const { load, save } = createLocalStorageInterface<TempStorageType>(USER_CHOICES_KEY);

/**
 * Saves user choices to local storage.
 * @alpha
 */
export function saveUserChoices(
  userChoices: LocalUserChoices,
  /**
   * Whether to prevent saving user choices to local storage.
   */
  preventSave: boolean = false,
): void {
  if (preventSave === true) {
    return;
  }
  save(userChoices);
}

/**
 * Reads the user choices from local storage, or returns the default settings if none are found.
 * @remarks
 * The deprecated parameters `e2ee` and `sharedPassphrase` are not read from local storage
 * and always return the value from the passed `defaults` or internal defaults.
 * @alpha
 */
export function loadUserChoices(
  defaults?: Partial<LocalUserChoices>,
  /**
   * Whether to prevent loading from local storage and return default values instead.
   * @defaultValue false
   */
  preventLoad: boolean = false,
): LocalUserChoices {
  const fallback: LocalUserChoices = {
    videoEnabled: defaults?.videoEnabled ?? defaultUserChoices.videoEnabled,
    audioEnabled: defaults?.audioEnabled ?? defaultUserChoices.audioEnabled,
    videoDeviceId: defaults?.videoDeviceId ?? defaultUserChoices.videoDeviceId,
    audioDeviceId: defaults?.audioDeviceId ?? defaultUserChoices.audioDeviceId,
    username: defaults?.username ?? defaultUserChoices.username,
  };

  if (preventLoad) {
    return fallback;
  } else {
    const maybeLoadedObject = load();
    const result = { ...fallback, ...(maybeLoadedObject ?? {}) };
    return result;
  }
}
