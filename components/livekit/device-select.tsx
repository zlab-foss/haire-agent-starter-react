'use client';

import { cva } from 'class-variance-authority';
import { Track } from 'livekit-client';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useAgentEvents } from '@/agent-sdk';
import { LocalTrackEvent, LocalTrackInstance } from '@/agent-sdk/agent-session/LocalTrack';

type DeviceSelectProps = React.ComponentProps<typeof SelectTrigger> & {
  track: LocalTrackInstance<Track.Source.Camera | Track.Source.Microphone>;
  requestPermissions?: boolean;
  onDeviceSelectError?: (error: Error, source: Track.Source.Camera | Track.Source.Microphone) => void;
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
  track,
  requestPermissions,
  onDeviceSelectError,
  ...props
}: DeviceSelectProps) {
  const size = props.size || 'default';

  useAgentEvents(track, LocalTrackEvent.ActiveDeviceChangeError, onDeviceSelectError);

  return (
    <Select
      value={track?.devices?.activeId}
      onValueChange={track?.devices?.changeActive}
      disabled={track.devices.list.length === 0}
    >
      <SelectTrigger className={cn(selectVariants({ size }), props.className)}>
        {size !== 'sm' && (
          <SelectValue className="font-mono text-sm" placeholder={`Select a ${track?.devices?.kind}`} />
        )}
      </SelectTrigger>
      <SelectContent>
        {track.devices.list.map((device) => (
          <SelectItem key={device.deviceId} value={device.deviceId} className="font-mono text-xs">
            {device.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
