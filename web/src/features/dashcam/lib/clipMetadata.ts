/** Minimal shape this module needs from an `HTMLVideoElement`, kept narrow so it's mockable in tests. */
export interface VideoDurationProbe {
  src: string;
  preload: string;
  duration: number;
  onloadedmetadata: (() => void) | null;
  onerror: (() => void) | null;
}

/**
 * Best-effort clip duration probe: loads just the metadata of a local
 * object URL via an off-DOM `<video>` element. Returns `null` — never
 * throws — when the browser can't decode the clip or the probe times out,
 * so callers can still catalog the clip with an explicit "duration
 * unknown" state instead of failing the whole import.
 */
export async function probeVideoDuration(
  objectUrl: string,
  opts?: { createElement?: () => VideoDurationProbe; timeoutMs?: number },
): Promise<number | null> {
  const timeoutMs = opts?.timeoutMs ?? 4000;
  const createElement =
    opts?.createElement ??
    (() => {
      if (typeof document === 'undefined') throw new Error('document is unavailable');
      return document.createElement('video') as unknown as VideoDurationProbe;
    });

  try {
    const video = createElement();
    video.preload = 'metadata';
    const duration = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('probeVideoDuration: timed out')), timeoutMs);
      video.onloadedmetadata = () => {
        clearTimeout(timer);
        resolve(video.duration);
      };
      video.onerror = () => {
        clearTimeout(timer);
        reject(new Error('probeVideoDuration: metadata load failed'));
      };
      video.src = objectUrl;
    });
    return Number.isFinite(duration) && duration > 0 ? duration : null;
  } catch {
    return null;
  }
}
