import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { EngineError } from "../engine/api/errors";
import type { Library } from "../engine/api/facade";
import type { LibraryState } from "../engine/api/state";
import type { createBrowserEngine } from "../engine/host-browser/createBrowserEngine";
import { folderStore, privateStore } from "../engine/host-browser/stores";
import type { Store } from "../engine/storage/store";
import { pickFolder, rememberedFolder, rememberFolder, stillThere } from "./projectsFolder";

// Projects are kept until the browser is told otherwise; Chrome decides without asking the user.
export const keepStorage = () => void navigator.storage.persist().catch(() => undefined);

type FirstStore = Parameters<typeof createBrowserEngine>[0];

/** The remembered folder, when the user must act before the page can use it. */
export interface Waiting {
  /** `reopen`: Chrome asks again, on a later visit, before the page may use it. `missing`: it was moved, renamed or deleted since it was picked. */
  readonly kind: "reopen" | "missing";
  readonly name: string;
}

/** Where the projects are first kept: in the remembered folder, if the page may use it, adopting what is still inside Chrome; otherwise inside Chrome. */
async function firstStore(folder: FileSystemDirectoryHandle | undefined): Promise<{ readonly first: FirstStore; readonly waiting?: Waiting }> {
  if (folder === undefined) return { first: { store: await privateStore() } };
  const { name } = folder;
  if ((await folder.queryPermission({ mode: "readwrite" })) !== "granted") return { first: {}, waiting: { kind: "reopen", name } };
  if (!(await stillThere(folder))) return { first: {}, waiting: { kind: "missing", name } };
  return { first: { store: folderStore(folder), adoptFrom: await privateStore(), folderName: name } };
}

/**
 * The folder the projects are kept in, as far as the browser decides it: the one remembered from
 * an earlier visit, Chrome's permission to use it, picking folders, and asking the browser to keep
 * what is stored inside it. `onFirst` gets the store to start with once it is known. `onProblem`
 * gets what went wrong, or undefined once projects live in a newly picked folder.
 */
export function useProjectsFolder(
  library: LibraryState | undefined,
  onFirst: (first: FirstStore) => void,
  onProblem: (error: EngineError | undefined) => void,
) {
  const [waiting, setWaiting] = useState<Waiting | undefined>(undefined);
  // The remembered folder, to ask Chrome for again.
  const folderRef = useRef<FileSystemDirectoryHandle | undefined>(undefined);
  const found = useEffectEvent(onFirst);
  const failed = useEffectEvent(onProblem);

  useEffect(() => {
    let live = true;
    rememberedFolder()
      .then((folder) => {
        folderRef.current = folder;
        return firstStore(folder);
      })
      .then(
        ({ first, waiting: card }) => {
          if (!live) return;
          setWaiting(card);
          found(first);
        },
        () => {
          if (!live) return;
          found({});
          failed({ code: "projects-read-failed" });
        },
      );
    return () => {
      live = false;
    };
  }, []);

  // A folder on disk keeps its files whatever the browser does.
  const listed = library?.projects;
  const inBrowser = library?.place.kind === "browser";
  useEffect(() => {
    if (inBrowser && listed !== undefined && listed.length > 0) keepStorage();
  }, [inBrowser, listed]);

  /** Projects now live in `folder`; those still inside Chrome move in. */
  async function moveInto(library: Library, folder: FileSystemDirectoryHandle) {
    folderRef.current = folder;
    setWaiting(undefined);
    await library.folders.switchTo(folderStore(folder), { name: folder.name, adoptFrom: await privateStore() });
    onProblem(undefined);
  }

  return {
    waiting,
    /** Asks for a folder to keep the projects in, remembers it, and moves the projects there. */
    chooseFolder: async (library: Library) => {
      try {
        const folder = await pickFolder("redactorator-projects", "readwrite");
        if (folder === undefined) return;
        const checked = await library.folders.check(folderStore(folder));
        if (!checked.ok) onProblem({ code: "folder-not-chosen" });
        else if (checked.value === "one-project") onProblem({ code: "one-project", data: { name: folder.name } });
        else {
          await rememberFolder(folder);
          await moveInto(library, folder);
        }
      } catch {
        onProblem({ code: "folder-not-chosen" });
      }
    },
    /** Asks Chrome, on the user's click, to let the page use the remembered folder again. */
    reopenFolder: async (library: Library) => {
      const folder = folderRef.current;
      if (folder === undefined) return;
      if ((await folder.requestPermission({ mode: "readwrite" })) !== "granted") onProblem({ code: "folder-not-allowed", data: { name: folder.name } });
      else if (!(await stillThere(folder))) setWaiting({ kind: "missing", name: folder.name });
      else await moveInto(library, folder);
    },
    /** Asks for one project's folder, say one copied from another computer, to import. */
    pickProjectToImport: async (): Promise<Store | undefined> => {
      const folder = await pickFolder("redactorator-import", "read");
      return folder && folderStore(folder);
    },
  };
}
