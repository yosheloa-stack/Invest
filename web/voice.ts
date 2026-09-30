import { unlockAudio } from "./SignalDock";
import { COIN_NAMES, ticker } from "./format";
// Sound and voice stay on across visits. Browsers still need one tap per page load before
// they play audio, so the first tap anywhere unlocks both; nothing has to be switched on again.
const read = (key: string) => {
  try {
    return localStorage.getItem(key) !== "0";
  } catch {
    return true;
  }
};
const write = (key: string, on: boolean) => {
  try {
    localStorage.setItem(key, on ? "1" : "0");
  } catch {
    /* private mode */
  }
};
export const VOICE_KEY = "yosh-voice";
export const voiceOn = () => read(VOICE_KEY);
export const setVoice = (on: boolean) => write(VOICE_KEY, on);
let installed = false;
export function installUnlock() {
  if (installed) return;
  installed = true;
  let primed = false;
  const unlock = () => {
    void unlockAudio();
    if (primed) return;
    primed = true;
    // iOS only speaks after a first utterance started by a tap.
    try {
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      speechSynthesis.speak(u);
    } catch {
      /* no speech synthesis */
    }
  };
  // Not only the first tap: after the phone sleeps or the tab is hidden the browser suspends
  // audio again, and a single unlock left the alerts silent for the rest of the visit.
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void unlockAudio();
    else primed = false;
  });
}
// "Euro / Libra" → "Euro Libra"; unknown tickers are spelled as written.
export function spokenAsset(symbol: string) {
  const name = COIN_NAMES[symbol];
  if (name) return name.replace(/ · .*$/, "").replace(/ \/ /g, " ");
  return ticker(symbol).replace("/", " ");
}
let voice: SpeechSynthesisVoice | undefined;
function ptVoice() {
  if (voice) return voice;
  try {
    const all = speechSynthesis.getVoices();
    voice =
      all.find((v) => v.lang === "pt-BR") ??
      all.find((v) => v.lang.startsWith("pt"));
  } catch {
    /* no voices */
  }
  return voice;
}
export function speak(text: string) {
  if (!voiceOn() || !("speechSynthesis" in window)) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "pt-BR";
    const v = ptVoice();
    if (v) u.voice = v;
    u.rate = 1.05;
    // Chrome can leave the queue paused after the tab was hidden; nothing would ever speak.
    if (speechSynthesis.paused) speechSynthesis.resume();
    speechSynthesis.speak(u);
  } catch {
    /* speech unavailable */
  }
}
export const entryPhrase = (
  direction: "COMPRA" | "VENDA",
  symbol: string,
  minutes: number,
) =>
  `${direction === "COMPRA" ? "Compra" : "Venda"} no ${spokenAsset(symbol)}, expiração ${minutes} minutos`;
