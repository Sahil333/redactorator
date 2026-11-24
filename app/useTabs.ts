import { useEffect, useState } from "react";
import { isRecord } from "../engine/model/guards";
import type { DocumentId, ProjectDocument } from "./project";

interface OpenTabs {
  readonly tabs: readonly DocumentId[];
  readonly active: DocumentId | undefined;
}

// Which tabs are open is kept for this browser tab only, so a reload brings them back. It holds
// document ids, never anything from a document.
const storageKey = (projectId: string) => `redactorator:tabs:${projectId}`;

/** The tabs this browser tab last had open in the project, keeping only documents it still has. */
function remembered(projectId: string, documents: readonly ProjectDocument[]): OpenTabs | undefined {
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(storageKey(projectId)) ?? "null");
    if (!isRecord(stored) || !Array.isArray(stored.tabs)) return undefined;
    const known = new Map<unknown, DocumentId>(documents.map((document) => [document.id, document.id]));
    const tabs = stored.tabs.flatMap((id) => known.get(id) ?? []);
    const active = known.get(stored.active);
    // No tabs open is a choice the user made, kept like any other.
    return { tabs, active: active ?? tabs[0] };
  } catch {
    return undefined;
  }
}

/** The documents open in tabs, and the one shown. They outlast a reload of the page. */
export function useTabs(projectId: string, documents: readonly ProjectDocument[]) {
  const [open, setOpen] = useState<OpenTabs>(() => {
    const first = documents[0]?.id;
    return remembered(projectId, documents) ?? { tabs: first === undefined ? [] : [first], active: first };
  });

  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey(projectId), JSON.stringify(open));
    } catch {
      // Without session storage the tabs simply start afresh after a reload.
    }
  }, [projectId, open]);

  function show(id: DocumentId) {
    setOpen((current) => ({ tabs: current.tabs.includes(id) ? current.tabs : [...current.tabs, id], active: id }));
  }

  function close(id: DocumentId) {
    setOpen(({ tabs, active }) => {
      const index = tabs.indexOf(id);
      const rest = tabs.filter((each) => each !== id);
      return { tabs: rest, active: id === active ? rest[Math.min(index, rest.length - 1)] : active };
    });
  }

  return { tabs: open.tabs, active: open.active, open: show, close };
}
