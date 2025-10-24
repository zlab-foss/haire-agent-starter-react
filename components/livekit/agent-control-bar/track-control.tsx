'use client';

import { type TrackReferenceOrPlaceholder, useTrackToggle } from '@livekit/components-react';
import { TrackDeviceSelect } from '@/components/livekit/agent-control-bar/track-device-select';
import { TrackToggle } from '@/components/livekit/agent-control-bar/track-toggle';
import { AudioBarVisualizer } from '@/components/livekit/audio-visualizer/audio-bar-visualizer/audio-bar-visualizer';
import { cn } from '@/lib/utils';

interface TrackControlProps {
  kind: MediaDeviceKind;
  source: Parameters<typeof useTrackToggle>[0]['source'];
  pressed?: boolean;
  pending?: boolean;
  disabled?: boolean;
  className?: string;
  audioTrackRef?: TrackReferenceOrPlaceholder;
  onPressedChange?: (pressed: boolean) => void;
  onMediaDeviceError?: (error: Error) => void;
  onActiveDeviceChange?: (deviceId: string) => void;
}

export function TrackControl({
  kind,
  source,
  pressed,
  pending,
  disabled,
  className,
  audioTrackRef,
  onPressedChange,
  onMediaDeviceError,
  onActiveDeviceChange,
}: TrackControlProps) {
  return (
    <div className={cn('flex items-center gap-0', className)}>
      <TrackToggle
        size="icon"
        variant="primary"
        source={source}
        pressed={pressed}
        pending={pending}
        disabled={disabled}
        onPressedChange={onPressedChange}
        className="peer/track group/track has-[.audiovisualizer]:w-auto has-[~_button]:rounded-r-none has-[~_button]:pr-2 has-[~_button]:pl-3"
      >
        {audioTrackRef && (
          <AudioBarVisualizer
            size="icon"
            audioTrack={audioTrackRef!}
            className="audiovisualizer aspect-auto w-3 px-0"
          />
        )}
      </TrackToggle>
      <hr className="bg-border peer-data-[state=off]/track:bg-destructive/20 relative z-10 -mr-px hidden h-4 w-px border-none has-[~_button]:block" />
      <TrackDeviceSelect
        size="sm"
        kind={kind}
        requestPermissions={false}
        onMediaDeviceError={onMediaDeviceError}
        onActiveDeviceChange={onActiveDeviceChange}
        className={cn([
          'rounded-l-none pl-2',
          'peer-data-[state=off]/track:text-destructive',
          'hover:text-foreground focus:text-foreground',
          'hover:peer-data-[state=off]/track:text-foreground',
          'focus:peer-data-[state=off]/track:text-destructive',
        ])}
      />
    </div>
  );
}
