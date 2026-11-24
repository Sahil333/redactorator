import type { ErrorCode, Refusal, Result } from "../../../api/errors";
import type { IncomingFile, Session } from "../../../api/facade";
import type { Project, ProjectDocument } from "../../../model/project";
import { hiddenTextKeys, spreadToAdded, type TextPlace } from "../../../model/spread";
import type { Store } from "../../../storage/store";
import type { Intake } from "../../intake";
import type { PdfClient } from "../../pdf-client/client";
import { writeOriginals } from "../../stored/projects";
import type { SessionChange } from "../changes";
import type { SessionView } from "../gate";
import { findPlaces } from "./readings";

/** What adding documents uses: where the project is kept, intake, the PDF worker's search, the Session's gate, and how changes land. */
interface AddHost {
  readonly store: Store;
  readonly folder: string;
  readonly client: Pick<PdfClient, "match">;
  intake(files: readonly IncomingFile[]): Promise<Intake>;
  allowed(command: "addDocuments"): Result<SessionView>;
  dispatch(change: SessionChange, ...effects: (() => void)[]): void;
  /** Dispatches a change to the project record, which saves it. */
  change(change: SessionChange): void;
}

type Added = Awaited<ReturnType<Session["documents"]["add"]>>;

const refusals = (files: readonly string[], code: ErrorCode): Refusal[] => files.map((file) => ({ file, error: { code } }));

/**
 * Adding chosen files to the project: intake, then the search for the project's hidden values,
 * then writing each file, and only then the documents join, with those values spread into them.
 * `settled` resolves once no add is under way.
 */
export function adderOf({ store, folder, client, intake, allowed, dispatch, change }: AddHost): Pick<Session["documents"], "add"> & { settled(): Promise<unknown> } {
  let underWay: Promise<unknown> = Promise.resolve();

  /** Ends the add with nothing added: `refused` are every chosen file it refuses. */
  function failed(refused: readonly Refusal[]): Added {
    dispatch({ type: "addFailed" });
    return { ok: true, value: { added: [], refused } };
  }

  async function run(files: readonly IncomingFile[], from: Project): Promise<Added> {
    const taken = await intake(files);
    const refuseAll = (code: ErrorCode) => failed([...taken.refused, ...refusals(taken.added.map(({ file }) => file), code)]);
    // Searched before anything is written, so no document joins without the project's hidden values.
    let places: TextPlace[];
    try {
      places = await findPlaces(client, hiddenTextKeys(from), taken.added.map(({ id, reading }) => ({ id, texts: reading.texts })));
    } catch {
      return refuseAll("add-search-failed");
    }
    let documents: ProjectDocument[];
    try {
      documents = await writeOriginals(store, { folder, project: from }, taken.added);
    } catch {
      return refuseAll("add-save-failed");
    }
    const readings = new Map(taken.added.map((each) => [each.id, each.reading]));
    change({ type: "documentsAdded", documents: spreadToAdded(from, documents, readings, places) });
    return { ok: true, value: { added: documents.map(({ id }) => id), refused: taken.refused } };
  }

  return {
    add(files) {
      const at = allowed("addDocuments");
      if (!at.ok) return Promise.resolve(at);
      const from = at.value.parts.record.present.project;
      const added = new Promise<Added>((resolve) =>
        dispatch({ type: "addStarted" }, () => resolve(run(files, from).catch(() => failed(refusals(files.map(({ name }) => name), "add-save-failed"))))),
      );
      underWay = added;
      return added;
    },
    settled: () => underWay,
  };
}
