/* Pin-on-top + focus fullscreen.
   Electron (.exe): real always-on-top at the highest Windows level.
   Browser: fullscreen is the strongest thing a web page may do. */

export type PinState = { pinned: boolean; fullscreen: boolean };

type PinAPI = {
  setPin: (f: boolean) => Promise<PinState>;
  getPin: () => Promise<PinState>;
  setFullscreen: (f: boolean) => Promise<PinState>;
  onPinState: (cb: (s: PinState) => void) => () => void;
};

const api = (): PinAPI | null => {
  const e = (window as any).electronAPI;
  return e && typeof e.setPin === "function" ? (e as PinAPI) : null;
};

export const canTruePin = () => !!api();

const LS = "alif:pinned";

export function loadPinPref(): boolean {
  try {
    return localStorage.getItem(LS) === "1";
  } catch {
    return false;
  }
}

function savePinPref(v: boolean) {
  try {
    localStorage.setItem(LS, v ? "1" : "0");
  } catch {
    /* ignore */
  }
}

const isDocFullscreen = () => !!document.fullscreenElement;

export async function setPinned(flag: boolean): Promise<PinState> {
  savePinPref(flag);
  const a = api();
  if (a) return a.setPin(flag);
  // browser fallback: fullscreen keeps other windows from covering the reader
  try {
    if (flag && !isDocFullscreen()) await document.documentElement.requestFullscreen({ navigationUI: "hide" } as any);
    if (!flag && isDocFullscreen()) await document.exitFullscreen();
  } catch {
    /* user gesture required / denied */
  }
  return { pinned: flag && isDocFullscreen(), fullscreen: isDocFullscreen() };
}

export async function setFullscreen(flag: boolean): Promise<PinState> {
  const a = api();
  if (a) return a.setFullscreen(flag);
  try {
    if (flag && !isDocFullscreen()) await document.documentElement.requestFullscreen();
    if (!flag && isDocFullscreen()) await document.exitFullscreen();
  } catch {
    /* ignore */
  }
  return { pinned: false, fullscreen: isDocFullscreen() };
}

export async function getPinState(): Promise<PinState> {
  const a = api();
  if (a) return a.getPin();
  return { pinned: false, fullscreen: isDocFullscreen() };
}

export function onPinState(cb: (s: PinState) => void): () => void {
  const a = api();
  if (a) return a.onPinState(cb);
  const fn = () => cb({ pinned: false, fullscreen: isDocFullscreen() });
  document.addEventListener("fullscreenchange", fn);
  return () => document.removeEventListener("fullscreenchange", fn);
}
