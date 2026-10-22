import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="size-5" {...props}>
      {children}
    </svg>
  );
}

export const MicIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </Icon>
);
export const MicOffIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M15 9.3V6a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 4.9 2.3M5 11a7 7 0 0 0 11.5 5.4M19 11a7 7 0 0 1-.6 2.8M12 18v3M3 3l18 18" />
  </Icon>
);
export const VideoIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="6" width="13" height="12" rx="2" />
    <path d="m16 10 5-3v10l-5-3" />
  </Icon>
);
export const VideoOffIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10.7 6H14a2 2 0 0 1 2 2v3.3l5-4.3v10M16 16a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2M3 3l18 18" />
  </Icon>
);
export const PhoneOffIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.6 14.6c4.7-4.1 12.1-4.1 16.8 0 .5.5.6 1.3.1 1.9l-1.3 1.6a1.4 1.4 0 0 1-1.8.3l-2.2-1.3a1.4 1.4 0 0 1-.6-1.4l.2-1.2a10 10 0 0 0-5.6 0l.2 1.2a1.4 1.4 0 0 1-.6 1.4l-2.2 1.3a1.4 1.4 0 0 1-1.8-.3l-1.3-1.6c-.5-.6-.4-1.4.1-1.9Z" />
  </Icon>
);
export const CopyIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V6a2 2 0 0 1 2-2h8" />
  </Icon>
);
export const CaptionsIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M10 10.5a2 2 0 1 0 0 3M17 10.5a2 2 0 1 0 0 3" />
  </Icon>
);
export const TranslateIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 5h8M8 3v2M10.5 5c-.7 3.6-3 6.4-6 8M6 9c1 1.8 2.6 3.2 4.5 4M13 21l4-10 4 10M14.5 17.5h5" />
  </Icon>
);
export const SpeakerIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 9h3l5-4v14l-5-4H4zM16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" />
  </Icon>
);
export const ShieldIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6z" />
    <path d="m9 12 2 2 4-4" />
  </Icon>
);
export const CheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m5 12 5 5L20 7" />
  </Icon>
);
