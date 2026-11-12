/**
 * Capability-based share and copy. Pure and injectable so the matrix can be
 * unit tested without a browser.
 *
 * Rules:
 *  - Native share only when navigator.share exists AND the device has a
 *    coarse pointer. Desktop never opens the share sheet; it copies.
 *  - Each action makes exactly one gesture-bound call. No retry chains: a
 *    failed share is never followed by a second share or a clipboard write,
 *    because navigator.share() consumes the transient user activation.
 *  - AbortError (the user closed the sheet) is "cancelled", with no feedback.
 *    Any other native error is "unsupported" and the UI shows its Copy button.
 */

export type ShareOutcome = "shared" | "copied" | "manual" | "cancelled" | "unsupported";

export interface ShareEnv {
  nav: Navigator;
  doc: Document;
  coarsePointer: boolean;
}

export interface ShareCapabilities {
  nativeText: boolean;
  nativeFile: (f: File) => boolean;
  clipboard: boolean;
}

export function defaultEnv(): ShareEnv {
  return {
    nav: navigator,
    doc: document,
    coarsePointer:
      typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches,
  };
}

/** The canonical site URL for share text. */
export function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin;
}

export function shareCapabilities(env: ShareEnv): ShareCapabilities {
  const nativeText = typeof env.nav.share === "function" && env.coarsePointer;
  return {
    nativeText,
    nativeFile: (f) =>
      nativeText && typeof env.nav.canShare === "function" && env.nav.canShare({ files: [f] }),
    clipboard: typeof env.nav.clipboard?.writeText === "function",
  };
}

function isAbort(err: unknown): boolean {
  return (
    typeof err === "object" && err !== null && (err as { name?: string }).name === "AbortError"
  );
}

/** Native share, text only. One call, no fallback. */
export async function shareText(text: string, env: ShareEnv = defaultEnv()): Promise<ShareOutcome> {
  if (!shareCapabilities(env).nativeText) return "unsupported";
  try {
    await env.nav.share({ text });
    return "shared";
  } catch (err) {
    return isAbort(err) ? "cancelled" : "unsupported";
  }
}

/** Native share with the card image attached. One call, no fallback. */
export async function shareCard(
  text: string,
  file: File,
  env: ShareEnv = defaultEnv(),
): Promise<ShareOutcome> {
  if (!shareCapabilities(env).nativeFile(file)) return "unsupported";
  try {
    await env.nav.share({ text, files: [file] });
    return "shared";
  } catch (err) {
    return isAbort(err) ? "cancelled" : "unsupported";
  }
}

/** execCommand copy via a hidden textarea. Works on insecure origins. */
function execCopy(text: string, doc: Document): boolean {
  if (typeof doc.execCommand !== "function" || !doc.body) return false;
  const ta = doc.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.setAttribute("aria-hidden", "true");
  ta.style.position = "fixed";
  ta.style.top = "0";
  ta.style.left = "-9999px";
  ta.style.opacity = "0";
  doc.body.appendChild(ta);
  try {
    ta.focus();
    ta.select();
    ta.setSelectionRange?.(0, text.length);
    return doc.execCommand("copy");
  } catch {
    return false;
  } finally {
    ta.remove?.();
  }
}

/**
 * Clipboard API, then execCommand, else "manual" (the UI opens a dialog with a
 * pre-selected textarea). With no clipboard API the execCommand path runs
 * synchronously inside the tap, so the user gesture is still alive.
 */
export async function copyText(text: string, env: ShareEnv = defaultEnv()): Promise<ShareOutcome> {
  if (typeof env.nav.clipboard?.writeText === "function") {
    try {
      await env.nav.clipboard.writeText(text);
      return "copied";
    } catch {
      // fall through to execCommand
    }
  }
  return execCopy(text, env.doc) ? "copied" : "manual";
}
