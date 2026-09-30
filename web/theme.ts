import { useSyncExternalStore } from "react";
// Black or white theme, remembered per browser; the first visit follows the system setting.
export type Theme = "dark" | "light";
const listeners = new Set<() => void>();
function initial(): Theme {
  try {
    const saved = localStorage.getItem("yosh-theme");
    if (saved === "dark" || saved === "light") return saved;
  } catch {
    /* private mode */
  }
  return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}
let current: Theme = initial();
document.documentElement.dataset.theme = current;
export function setTheme(t: Theme) {
  current = t;
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem("yosh-theme", t);
  } catch {
    /* private mode */
  }
  for (const f of listeners) f();
}
export const useTheme = () =>
  useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => void listeners.delete(f);
    },
    () => current,
    () => current,
  );
// Colors for canvas-drawn parts (chart, 3D), which CSS variables cannot reach.
export const PALETTE = {
  dark: {
    bg: "#000000",
    panel: "#0c0d10",
    text: "#e3e5ea",
    muted: "#868993",
    grid: "rgba(255,255,255,.06)",
    line: "#202227",
    crosshair: "#6a6d78",
    label: "#2a2d34",
    watermark: "rgba(255,255,255,.06)",
    up: "#089981",
    down: "#f23645",
    // Candle-pattern marks: their own hues so they never blend into green/red candles.
    patternUp: "#18ffff",
    patternDown: "#ffd600",
    blue: "#2962ff",
    orange: "#ff9800",
    ema9: "#2962ff",
    ema21: "#ff9800",
    ema50: "#e040fb",
    bb: "#2196f3",
    vwap: "#e91e63",
    rsi: "#7e57c2",
    volUp: "rgba(8,153,129,.5)",
    volDown: "rgba(242,54,69,.5)",
    fog: 0x0c0d10,
    grid3d: [0x2a2d34, 0x17181c] as [number, number],
    flat: 0x868993,
  },
  light: {
    bg: "#f0f3fa",
    panel: "#ffffff",
    text: "#131722",
    muted: "#6a6d78",
    grid: "rgba(19,23,34,.06)",
    line: "#e0e3eb",
    crosshair: "#9598a1",
    label: "#131722",
    watermark: "rgba(19,23,34,.06)",
    up: "#089981",
    down: "#f23645",
    patternUp: "#0060a8",
    patternDown: "#8d5a00",
    blue: "#2962ff",
    orange: "#f57c00",
    ema9: "#2962ff",
    ema21: "#f57c00",
    ema50: "#ab47bc",
    bb: "#1e88e5",
    vwap: "#d81b60",
    rsi: "#7e57c2",
    volUp: "rgba(8,153,129,.35)",
    volDown: "rgba(242,54,69,.35)",
    fog: 0xffffff,
    grid3d: [0xd1d4dc, 0xe8eaf0] as [number, number],
    flat: 0x9598a1,
  },
};
export type Palette = (typeof PALETTE)["dark"];
