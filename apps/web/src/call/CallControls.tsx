import { type ReactNode, useEffect, useState } from 'react';
import { CaptionsIcon, MicIcon, MicOffIcon, PhoneOffIcon, SpeakerIcon, TranslateIcon, VideoIcon, VideoOffIcon } from '../components/icons';
import { supportsOutputSelection } from './RemoteAudio';

function ControlButton({
  label,
  pressed,
  onClick,
  children,
  tone = 'default',
  disabled,
}: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
  tone?: 'default' | 'off' | 'danger';
  disabled?: boolean;
}) {
  const colors =
    tone === 'danger'
      ? 'bg-red-600 hover:bg-red-500 text-white'
      : tone === 'off'
        ? 'bg-white text-ink hover:bg-white/90'
        : 'bg-white/10 text-white hover:bg-white/20';
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={`flex size-12 items-center justify-center rounded-full transition-colors disabled:opacity-40 focus-visible:outline-teal-300 ${colors}`}
    >
      {children}
    </button>
  );
}

export interface AudioSettings {
  originalVolume: number;
  sinkId: string;
}

export function CallControls({
  isVideo,
  micMuted,
  cameraOff,
  cameraAvailable,
  captionsOn,
  translationEnabled,
  audio,
  onMic,
  onCamera,
  onCaptions,
  onTranslation,
  onAudio,
  onEnd,
}: {
  isVideo: boolean;
  micMuted: boolean;
  cameraOff: boolean;
  cameraAvailable: boolean;
  captionsOn: boolean;
  translationEnabled: boolean;
  audio: AudioSettings;
  onMic: () => void;
  onCamera: () => void;
  onCaptions: () => void;
  onTranslation: () => void;
  onAudio: (s: AudioSettings) => void;
  onEnd: () => void;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    if (!settingsOpen || !supportsOutputSelection()) return;
    void navigator.mediaDevices.enumerateDevices().then((d) => setOutputs(d.filter((x) => x.kind === 'audiooutput')));
  }, [settingsOpen]);

  return (
    <div className="relative flex flex-wrap items-center justify-center gap-3">
      <ControlButton label={micMuted ? 'Unmute microphone' : 'Mute microphone'} pressed={micMuted} tone={micMuted ? 'off' : 'default'} onClick={onMic}>
        {micMuted ? <MicOffIcon /> : <MicIcon />}
      </ControlButton>
      {isVideo && (
        <ControlButton
          label={cameraOff ? 'Turn camera on' : 'Turn camera off'}
          pressed={cameraOff}
          tone={cameraOff || !cameraAvailable ? 'off' : 'default'}
          onClick={onCamera}
          disabled={!cameraAvailable}
        >
          {cameraOff || !cameraAvailable ? <VideoOffIcon /> : <VideoIcon />}
        </ControlButton>
      )}
      <ControlButton label={captionsOn ? 'Hide captions' : 'Show captions'} pressed={captionsOn} onClick={onCaptions}>
        <CaptionsIcon />
      </ControlButton>
      <ControlButton
        label={translationEnabled ? 'Pause translating my speech' : 'Resume translating my speech'}
        pressed={!translationEnabled}
        tone={translationEnabled ? 'default' : 'off'}
        onClick={onTranslation}
      >
        <TranslateIcon />
      </ControlButton>
      <ControlButton label="Audio settings" pressed={settingsOpen} onClick={() => setSettingsOpen((o) => !o)}>
        <SpeakerIcon />
      </ControlButton>
      <ControlButton label="End call" tone="danger" onClick={onEnd}>
        <PhoneOffIcon />
      </ControlButton>

      {settingsOpen && (
        <div role="dialog" aria-label="Audio settings" className="absolute bottom-16 z-30 w-72 rounded-xl bg-white p-4 text-sm text-ink shadow-2xl">
          <label className="block font-medium" htmlFor="original-volume">
            Other person's original voice
          </label>
          <p className="text-xs text-muted">Lower it to hear the translation more clearly.</p>
          <input
            id="original-volume"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={audio.originalVolume}
            onChange={(e) => onAudio({ ...audio, originalVolume: Number(e.target.value) })}
            className="mt-2 w-full accent-teal-700"
          />
          {supportsOutputSelection() ? (
            <>
              <label className="mt-4 block font-medium" htmlFor="audio-output">
                Speaker
              </label>
              <select
                id="audio-output"
                className="mt-1 h-9 w-full rounded-lg border border-line px-2"
                value={audio.sinkId}
                onChange={(e) => onAudio({ ...audio, sinkId: e.target.value })}
              >
                <option value="">System default</option>
                {outputs
                  .filter((o) => o.deviceId && o.deviceId !== 'default')
                  .map((o, i) => (
                    <option key={o.deviceId} value={o.deviceId}>
                      {o.label || `Speaker ${i + 1}`}
                    </option>
                  ))}
              </select>
            </>
          ) : (
            <p className="mt-4 text-xs text-muted">This browser uses the system speaker setting.</p>
          )}
          <p className="mt-4 text-xs text-muted">Tip: headphones give the clearest translations and prevent echo.</p>
        </div>
      )}
    </div>
  );
}
