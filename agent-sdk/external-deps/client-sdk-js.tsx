// This file contains pieces copied and pasted from the livekit-client package, largely internal
// things that aren't currently being exported.
//
// FIXME: export this stuff in livekit-client or explicitly vendor this stuff into the agents sdk

import { ChatMessage, ConnectionQuality, ConnectionState, DataPacket_Kind, DisconnectReason, LocalParticipant, LocalTrackPublication, LocalVideoTrack, Participant, RemoteParticipant, RemoteTrack, RemoteTrackPublication, SubscriptionError, Track, TrackPublication, TranscriptionSegment } from "livekit-client";
// import { type SipDtmf, type MetricsBatch } from '@livekit/protocol';
import { ParticipantPermission } from "livekit-server-sdk";

export interface BaseStreamInfo {
  id: string;
  mimeType: string;
  topic: string;
  timestamp: number;
  /** total size in bytes for finite streams and undefined for streams of unknown size */
  size?: number;
  attributes?: Record<string, string>;
}
export interface ByteStreamInfo extends BaseStreamInfo {
  name: string;
}

export interface TextStreamInfo extends BaseStreamInfo {}

export type ParticipantEventCallbacks = {
  trackPublished: (publication: RemoteTrackPublication) => void;
  trackSubscribed: (track: RemoteTrack, publication: RemoteTrackPublication) => void;
  trackSubscriptionFailed: (trackSid: string, reason?: SubscriptionError) => void;
  trackUnpublished: (publication: RemoteTrackPublication) => void;
  trackUnsubscribed: (track: RemoteTrack, publication: RemoteTrackPublication) => void;
  trackMuted: (publication: TrackPublication) => void;
  trackUnmuted: (publication: TrackPublication) => void;
  localTrackPublished: (publication: LocalTrackPublication) => void;
  localTrackUnpublished: (publication: LocalTrackPublication) => void;
  localTrackCpuConstrained: (track: LocalVideoTrack, publication: LocalTrackPublication) => void;
  localSenderCreated: (sender: RTCRtpSender, track: Track) => void;
  participantMetadataChanged: (prevMetadata: string | undefined, participant?: any) => void;
  participantNameChanged: (name: string) => void;
  dataReceived: (payload: Uint8Array, kind: DataPacket_Kind) => void;
  sipDTMFReceived: (dtmf: unknown /* SipDTMF */) => void;
  transcriptionReceived: (
    transcription: TranscriptionSegment[],
    publication?: TrackPublication,
  ) => void;
  isSpeakingChanged: (speaking: boolean) => void;
  connectionQualityChanged: (connectionQuality: ConnectionQuality) => void;
  trackStreamStateChanged: (
    publication: RemoteTrackPublication,
    streamState: Track.StreamState,
  ) => void;
  trackSubscriptionPermissionChanged: (
    publication: RemoteTrackPublication,
    status: TrackPublication.PermissionStatus,
  ) => void;
  mediaDevicesError: (error: Error, kind?: MediaDeviceKind) => void;
  audioStreamAcquired: () => void;
  participantPermissionsChanged: (prevPermissions?: ParticipantPermission) => void;
  trackSubscriptionStatusChanged: (
    publication: RemoteTrackPublication,
    status: TrackPublication.SubscriptionStatus,
  ) => void;
  attributesChanged: (changedAttributes: Record<string, string>) => void;
  localTrackSubscribed: (trackPublication: LocalTrackPublication) => void;
  chatMessage: (msg: ChatMessage) => void;
  active: () => void;
};

export type RoomEventCallbacks = {
  connected: () => void;
  reconnecting: () => void;
  signalReconnecting: () => void;
  reconnected: () => void;
  disconnected: (reason?: DisconnectReason) => void;
  connectionStateChanged: (state: ConnectionState) => void;
  moved: (name: string) => void;
  mediaDevicesChanged: () => void;
  participantConnected: (participant: RemoteParticipant) => void;
  participantDisconnected: (participant: RemoteParticipant) => void;
  trackPublished: (publication: RemoteTrackPublication, participant: RemoteParticipant) => void;
  trackSubscribed: (
    track: RemoteTrack,
    publication: RemoteTrackPublication,
    participant: RemoteParticipant,
  ) => void;
  trackSubscriptionFailed: (
    trackSid: string,
    participant: RemoteParticipant,
    reason?: SubscriptionError,
  ) => void;
  trackUnpublished: (publication: RemoteTrackPublication, participant: RemoteParticipant) => void;
  trackUnsubscribed: (
    track: RemoteTrack,
    publication: RemoteTrackPublication,
    participant: RemoteParticipant,
  ) => void;
  trackMuted: (publication: TrackPublication, participant: Participant) => void;
  trackUnmuted: (publication: TrackPublication, participant: Participant) => void;
  localTrackPublished: (publication: LocalTrackPublication, participant: LocalParticipant) => void;
  localTrackUnpublished: (
    publication: LocalTrackPublication,
    participant: LocalParticipant,
  ) => void;
  localAudioSilenceDetected: (publication: LocalTrackPublication) => void;
  participantMetadataChanged: (
    metadata: string | undefined,
    participant: RemoteParticipant | LocalParticipant,
  ) => void;
  participantNameChanged: (name: string, participant: RemoteParticipant | LocalParticipant) => void;
  participantPermissionsChanged: (
    prevPermissions: ParticipantPermission | undefined,
    participant: RemoteParticipant | LocalParticipant,
  ) => void;
  participantAttributesChanged: (
    changedAttributes: Record<string, string>,
    participant: RemoteParticipant | LocalParticipant,
  ) => void;
  activeSpeakersChanged: (speakers: Array<Participant>) => void;
  roomMetadataChanged: (metadata: string) => void;
  dataReceived: (
    payload: Uint8Array,
    participant?: RemoteParticipant,
    kind?: DataPacket_Kind,
    topic?: string,
  ) => void;
  sipDTMFReceived: (dtmf: unknown /* SipDTMF */, participant?: RemoteParticipant) => void;
  transcriptionReceived: (
    transcription: TranscriptionSegment[],
    participant?: Participant,
    publication?: TrackPublication,
  ) => void;
  connectionQualityChanged: (quality: ConnectionQuality, participant: Participant) => void;
  mediaDevicesError: (error: Error, kind?: MediaDeviceKind) => void;
  trackStreamStateChanged: (
    publication: RemoteTrackPublication,
    streamState: Track.StreamState,
    participant: RemoteParticipant,
  ) => void;
  trackSubscriptionPermissionChanged: (
    publication: RemoteTrackPublication,
    status: TrackPublication.PermissionStatus,
    participant: RemoteParticipant,
  ) => void;
  trackSubscriptionStatusChanged: (
    publication: RemoteTrackPublication,
    status: TrackPublication.SubscriptionStatus,
    participant: RemoteParticipant,
  ) => void;
  audioPlaybackChanged: (playing: boolean) => void;
  videoPlaybackChanged: (playing: boolean) => void;
  signalConnected: () => void;
  recordingStatusChanged: (recording: boolean) => void;
  participantEncryptionStatusChanged: (encrypted: boolean, participant?: Participant) => void;
  encryptionError: (error: Error) => void;
  dcBufferStatusChanged: (isLow: boolean, kind: DataPacket_Kind) => void;
  activeDeviceChanged: (kind: MediaDeviceKind, deviceId: string) => void;
  chatMessage: (message: ChatMessage, participant?: RemoteParticipant | LocalParticipant) => void;
  localTrackSubscribed: (publication: LocalTrackPublication, participant: LocalParticipant) => void;
  metricsReceived: (metrics: unknown /* MetricsBatch */, participant?: Participant) => void;
  participantActive: (participant: Participant) => void;
};
