// Compact custom-creature share code (COSC2): raw-DEFLATE of the payload JSON
// against the same frozen preset dictionary the match-snapshot links use
// (game names / ability ids / JSON keys), base64url-packed with the dictionary
// version in the prefix. Mirrors the COSM4 path in matchSnapshot.ts; reusing
// the shared dictionary is what makes a creature code compress well without a
// second dictionary to version. The legacy COSC1 (plain base64 JSON) still
// decodes, and the encoder emits whichever form is shorter.
import { deflateRaw, inflateRaw, type InflateFunctionOptions } from "pako";
import { SHARE_DICTIONARIES, SHARE_DICTIONARY_VERSION } from "./shareDictionary";

export const CUSTOM_CREATURE_CODE_PREFIX_V2 = "COSC2:";

declare const Buffer: {
  from(input: Uint8Array): { toString(encoding: string): string };
  from(input: string, encoding: string): Uint8Array;
};

function bytesToBase64Url(bytes: Uint8Array): string {
  let base64: string;
  if (typeof btoa === "function") {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    base64 = btoa(binary);
  } else {
    base64 = Buffer.from(bytes).toString("base64");
  }
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(encoded: string): Uint8Array {
  const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.length % 4 === 0 ? normalized : `${normalized}${"=".repeat(4 - (normalized.length % 4))}`;
  if (typeof atob === "function") {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  return new Uint8Array(Buffer.from(padded, "base64"));
}

export function deflateCustomCreatureCode(json: string): string {
  const deflated = deflateRaw(json, {
    level: 9,
    dictionary: SHARE_DICTIONARIES[SHARE_DICTIONARY_VERSION],
  });
  return `${CUSTOM_CREATURE_CODE_PREFIX_V2}${SHARE_DICTIONARY_VERSION.toString(36)}.${bytesToBase64Url(deflated)}`;
}

// Returns the inflated JSON string, or null if `code` isn't a valid COSC2 token.
export function inflateCustomCreatureCode(code: string): string | null {
  if (!code.startsWith(CUSTOM_CREATURE_CODE_PREFIX_V2)) return null;
  const rest = code.slice(CUSTOM_CREATURE_CODE_PREFIX_V2.length);
  const dot = rest.indexOf(".");
  if (dot === -1) return null;
  const dictionary = SHARE_DICTIONARIES[parseInt(rest.slice(0, dot), 36)];
  if (!dictionary) return null;
  try {
    // @types/pako omits `dictionary` from InflateFunctionOptions (it is typed
    // on the Inflate class options); pako supports it at runtime.
    const restored = inflateRaw(base64UrlToBytes(rest.slice(dot + 1)), {
      dictionary,
      to: "string",
    } as InflateFunctionOptions & { to: "string"; dictionary: string });
    return restored || null;
  } catch {
    return null;
  }
}
