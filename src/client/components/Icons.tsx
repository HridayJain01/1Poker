const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export const IconMenu = () => (
  <svg viewBox="0 0 24 24" {...P}>
    <path d="M4 7h16M4 12h16M4 17h10" />
  </svg>
);
export const IconChat = () => (
  <svg viewBox="0 0 24 24" {...P}>
    <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
  </svg>
);
export const IconBack = () => (
  <svg viewBox="0 0 24 24" {...P}>
    <path d="M15 18l-6-6 6-6" />
  </svg>
);
export const IconClose = () => (
  <svg viewBox="0 0 24 24" {...P}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
export const IconShare = () => (
  <svg viewBox="0 0 24 24" {...P}>
    <path d="M12 3v12M7 8l5-5 5 5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />
  </svg>
);
export const IconSend = () => (
  <svg viewBox="0 0 24 24" {...P}>
    <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
  </svg>
);
export const IconMic = () => (
  <svg viewBox="0 0 24 24" {...P}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </svg>
);
export const IconCamera = () => (
  <svg viewBox="0 0 24 24" {...P}>
    <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
    <circle cx="12" cy="13" r="3.5" />
  </svg>
);
export const IconSmile = () => (
  <svg viewBox="0 0 24 24" {...P}>
    <circle cx="12" cy="12" r="9" />
    <path d="M8 14s1.5 2 4 2 4-2 4-2M9 9.5h.01M15 9.5h.01" />
  </svg>
);
