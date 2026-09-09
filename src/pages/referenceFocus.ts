// A one-shot handoff for "open the Reference on this entry".
//
// Both Reference pages own their own search box, and the banner that links to
// an entry is rendered outside either of them. The name is left here, the page
// takes it when it mounts, and it is gone after that - a second visit to the
// Reference opens it the way the reader left it.

let pendingEntryName: string | null = null;

export function requestReferenceEntry(name: string): void {
  pendingEntryName = name;
}

export function takeRequestedReferenceEntry(): string | null {
  const name = pendingEntryName;
  pendingEntryName = null;
  return name;
}
