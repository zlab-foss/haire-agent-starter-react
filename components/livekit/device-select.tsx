'use client';

import { cva } from 'class-variance-authority';
import { /* LocalAudioTrack, LocalVideoTrack, */ Track } from 'livekit-client';
// import { useMaybeRoomContext, useMediaDeviceSelect } from '@livekit/components-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useAgentEvents /*, useAgentMediaDeviceSelect */ } from '@/agent-sdk';
import { LocalTrackEvent, LocalTrackInstance } from '@/agent-sdk/agent-session/LocalTrack';

type DeviceSelectProps = React.ComponentProps<typeof SelectTrigger> & {
  track: LocalTrackInstance<Track.Source.Camera | Track.Source.Microphone> ;
  // kind: MediaDeviceKind;
  // track?: LocalAudioTrack | LocalVideoTrack | undefined;
  requestPermissions?: boolean;
  onMediaDeviceError?: (error: Error) => void;
  initialSelection?: string;
  onActiveDeviceChange?: (deviceId: string) => void;
  onDeviceListChange?: (devices: MediaDeviceInfo[]) => void;
  variant?: 'default' | 'small';
};

const selectVariants = cva(
  [
    'w-full rounded-full px-3 py-2 text-sm cursor-pointer',
    'disabled:not-allowed hover:bg-button-hover focus:bg-button-hover',
  ],
  {
    variants: {
      size: {
        default: 'w-[180px]',
        sm: 'w-auto',
      },
    },
    defaultVariants: {
      size: 'default',
    },
  }
);

export function DeviceSelect({
  // kind,
  track,
  requestPermissions,
  onMediaDeviceError,
  // initialSelection,
  // onActiveDeviceChange,
  // onDeviceListChange,
  ...props
}: DeviceSelectProps) {
  const size = props.size || 'default';

  // const { devices, activeDeviceId, setActiveMediaDevice } = useAgentMediaDeviceSelect({
  //   kind,
  //   requestPermissions,
  //   onError: onMediaDeviceError,
  // });

  useAgentEvents(track, LocalTrackEvent.ActiveDeviceChangeError, onMediaDeviceError);

  // const { devices, activeDeviceId, setActiveMediaDevice } = useMediaDeviceSelect({
  //   kind,
  //   room: agentSession.room,
  //   track,
  //   requestPermissions,
  //   onError: onMediaDeviceError,
  // });
  return (
    <Select value={track?.devices?.activeId} onValueChange={track?.devices?.changeActive}>
      <SelectTrigger className={cn(selectVariants({ size }), props.className)}>
        {size !== 'sm' && (
          <SelectValue className="font-mono text-sm" placeholder={`Select a ${track?.devices?.kind}`} />
        )}
      </SelectTrigger>
      <SelectContent>
        {track?.devices?.list?.map((device) => (
          <SelectItem key={device.deviceId} value={device.deviceId} className="font-mono text-xs">
            {device.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
