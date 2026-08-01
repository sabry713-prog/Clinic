/**
 * Shared dictation helpers — text-insertion logic used by any field that
 * accepts transcribed speech (draft sections, the order quick-entry box).
 * No recording/network logic here; see hooks/useDictation.ts for that.
 */

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string).split(",")[1] ?? "");
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Blank clinician-authored placeholders the draft inserts (EN + AR).
const PLACEHOLDER_RE = /\((?:Dictate or type [^)]*?here\.|أمل[ِi]? أو اكتب [^)]*?هنا\.)\)/g;

// Place dictated/typed text into a field. If the cursor sits inside a blank
// "(Dictate or type … here.)" placeholder, that placeholder is replaced; else
// the first remaining placeholder is filled (so dictation lands in the section
// the clinician is authoring, not at the end). With no placeholders left (the
// common case for a plain single-line field), the text is inserted at the
// cursor.
export function placeDictation(
  prev: string,
  insert: string,
  caret: number,
): { text: string; caret: number } {
  const placeholders = [...prev.matchAll(PLACEHOLDER_RE)];
  const here = placeholders.find((m) => caret >= m.index! && caret <= m.index! + m[0].length);
  const target = here ?? placeholders[0];
  if (target) {
    const start = target.index!;
    const text = prev.slice(0, start) + insert + prev.slice(start + target[0].length);
    return { text, caret: start + insert.length };
  }
  const at = Math.min(Math.max(caret, 0), prev.length);
  const needsNl = at > 0 && prev[at - 1] !== "\n";
  const text = prev.slice(0, at) + (needsNl ? "\n" : "") + insert + prev.slice(at);
  return { text, caret: at + insert.length + (needsNl ? 1 : 0) };
}
