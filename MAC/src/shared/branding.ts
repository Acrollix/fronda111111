export const brandTokens = {
  bgCanvas: "#080809",
  bgSidebar: "#0D0E11",
  bgPanel: "#121317",
  bgCard: "#17191E",
  bgCardElevated: "#1D2026",
  bgInput: "#101115",
  bgOverlay: "rgba(5,5,6,0.76)",
  textPrimary: "#F3F3F1",
  textSecondary: "#C1C4CB",
  textMuted: "#8E939D",
  textDisabled: "#666B74",
  textOnAccent: "#FFFFFF",
  borderSoft: "#262930",
  borderDefault: "#31343C",
  borderStrong: "#3D414B",
  borderAccent: "#E11812",
  accentPrimary: "#E11812",
  accentHover: "#F12B24",
  accentActive: "#B91410",
  accentDeep: "#7F100D",
  accentSoft: "rgba(225,24,18,0.12)",
  focusRing: "rgba(225,24,18,0.38)",
  dangerBg: "#221516",
  dangerBorder: "#8D1714",
  warningBg: "#241B14",
  warningBorder: "#8A4A18",
  successBg: "#16211C",
  successBorder: "#2F6A52"
} as const;

export const navigationSections = [
  "dashboard",
  "structure",
  "composition",
  "releases",
  "imports",
  "directories",
  "statistics",
  "system"
] as const;

export type NavigationSection = (typeof navigationSections)[number];
