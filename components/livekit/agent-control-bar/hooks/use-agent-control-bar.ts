import * as React from 'react';
import { useCallback } from 'react';
import { Track } from 'livekit-client';
import {
  type TrackReferenceOrPlaceholder,
  useLocalParticipant,
  usePersistentUserChoices,
  useRoomContext,
  useTrackToggle,
} from '@livekit/components-react';
import { usePublishPermissions } from './use-publish-permissions';
import { useAgentLocalParticipant, useAgentSession } from '@/agent-sdk';

export interface ControlBarControls {
  microphone?: boolean;
  screenShare?: boolean;
  chat?: boolean;
  camera?: boolean;
  leave?: boolean;
}

export interface UseAgentControlBarProps {
  controls?: ControlBarControls;
  saveUserChoices?: boolean;
  onDeviceError?: (error: { source: Track.Source; error: Error }) => void;
}

export interface UseAgentControlBarReturn {
  micTrackRef: TrackReferenceOrPlaceholder;
  visibleControls: ControlBarControls;
  microphoneToggle: ReturnType<typeof useTrackToggle<Track.Source.Microphone>>;
  cameraToggle: ReturnType<typeof useTrackToggle<Track.Source.Camera>>;
  screenShareToggle: ReturnType<typeof useTrackToggle<Track.Source.ScreenShare>>;
  handleDisconnect: () => void;
  handleAudioDeviceChange: (deviceId: string) => void;
  handleVideoDeviceChange: (deviceId: string) => void;
}

export function useAgentControlBar(props: UseAgentControlBarProps = {}): UseAgentControlBarReturn {
  const { controls, saveUserChoices = true } = props;
  const visibleControls = {
    leave: true,
    ...controls,
  };
  // const { microphoneTrack, /* localParticipant */ } = useLocalParticipant(); // FIXME: replace with agent alternative
  const {
    publishPermissions,
    microphone,
    camera,
    screenShare,
  } = useAgentLocalParticipant({
    onDeviceError: useCallback((error: Error, source: Track.Source) => props.onDeviceError?.({ source, error }), [props.onDeviceError]),
    saveUserTrackEnabledChoices: saveUserChoices,
  });
  // const publishPermissions = usePublishPermissions(); // FIXME: replace with agent alternative
  // const room = useRoomContext();
  const agentSession = useAgentSession();

  // const microphoneToggle = useTrackToggle({ // FIXME: replace with agent alternative
  //   source: Track.Source.Microphone,
  //   onDeviceError: (error) => props.onDeviceError?.({ source: Track.Source.Microphone, error }),
  // });
  // const cameraToggle = useTrackToggle({ // FIXME: replace with agent alternative
  //   source: Track.Source.Camera,
  //   onDeviceError: (error) => props.onDeviceError?.({ source: Track.Source.Camera, error }),
  // });
  // const screenShareToggle = useTrackToggle({ // FIXME: replace with agent alternative
  //   source: Track.Source.ScreenShare,
  //   onDeviceError: (error) => props.onDeviceError?.({ source: Track.Source.ScreenShare, error }),
  // });

  visibleControls.microphone ??= publishPermissions.microphone;
  visibleControls.screenShare ??= publishPermissions.screenShare;
  visibleControls.camera ??= publishPermissions.camera;
  visibleControls.chat ??= publishPermissions.data;

  // const {
  //   saveAudioInputEnabled,
  //   saveAudioInputDeviceId,
  //   saveVideoInputEnabled,
  //   saveVideoInputDeviceId,
  // } = usePersistentUserChoices({ // FIXME: replace with agent alternative
  //   preventSave: !saveUserChoices,
  // });

  const handleDisconnect = React.useCallback(async () => {
    // if (room) {
    //   await room.disconnect();
    // }
    await agentSession?.disconnect()
  }, [/* room */, agentSession]);

  // const handleAudioDeviceChange = React.useCallback(
  //   (deviceId: string) => {
  //     saveAudioInputDeviceId(deviceId ?? 'default');
  //   },
  //   [saveAudioInputDeviceId]
  // );

  // const handleVideoDeviceChange = React.useCallback(
  //   (deviceId: string) => {
  //     saveVideoInputDeviceId(deviceId ?? 'default');
  //   },
  //   [saveVideoInputDeviceId]
  // );

  // const handleToggleCamera = React.useCallback(
  //   async (enabled?: boolean) => {
  //     if (screenShareToggle.enabled) {
  //       screenShareToggle.toggle(false);
  //     }
  //     await cameraToggle.toggle(enabled);
  //     // persist video input enabled preference
  //     saveVideoInputEnabled(!cameraToggle.enabled);
  //   },
  //   [cameraToggle.enabled, screenShareToggle.enabled]
  // );

  // const handleToggleMicrophone = React.useCallback(
  //   async (enabled?: boolean) => {
  //     await microphoneToggle.toggle(enabled);
  //     // persist audio input enabled preference
  //     saveAudioInputEnabled(!microphoneToggle.enabled);
  //   },
  //   [microphoneToggle.enabled]
  // );

  // const handleToggleScreenShare = React.useCallback(
  //   async (enabled?: boolean) => {
  //     if (cameraToggle.enabled) {
  //       cameraToggle.toggle(false);
  //     }
  //     await screenShareToggle.toggle(enabled);
  //   },
  //   [screenShareToggle.enabled, cameraToggle.enabled]
  // );

  return {
    micTrackRef: microphone.track,
    visibleControls,
    cameraToggle: { ...camera, buttonProps: {} },
    microphoneToggle: { ...microphone, buttonProps: {} },
    screenShareToggle: { ...screenShare, buttonProps: {} },
    // cameraToggle: {
    //   ...cameraToggle,
    //   toggle: handleToggleCamera,
    // },
    // microphoneToggle: {
    //   ...microphoneToggle,
    //   toggle: handleToggleMicrophone,
    // },
    // screenShareToggle: {
    //   ...screenShareToggle,
    //   toggle: handleToggleScreenShare,
    // },
    handleDisconnect,
    handleAudioDeviceChange: microphone.changeDevice,
    handleVideoDeviceChange: camera.changeDevice,
  };
}
