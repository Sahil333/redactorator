import type { ComponentProps, RefObject } from "react";
import type { PageModel, PlacedImage } from "../engine/model/document";
import type { PageIndex } from "../engine/model/geometry";
import { CheckedBanner } from "./CheckedBanner";
import { baseName, savePdf } from "./download";
import { DropZone } from "./DropZone";
import { firstPage, markPages, type Mark } from "../engine/model/marks";
import type { Tool } from "./marks";
import { MarksPanel, marksPanelWidth } from "./MarksPanel";
import { pageFrameId, PageScale, showMark } from "./pageGeometry";
import { PageList } from "./PageList";
import type { HiddenValue } from "../engine/model/project";
import { ReviewBanner } from "./ReviewBanner";
import type { Reach } from "../engine/model/spread";
import { Splitter } from "./Splitter";
import { Thumbnails, thumbnailsWidth } from "./Thumbnails";
import type { EngineError } from "../engine/api/errors";
import type { Session } from "../engine/api/facade";
import type { DocumentHandle } from "../engine/api/state";
import { errorText } from "./errors";
import { FindingsPanel } from "./FindingsPanel";
import { usePageImages } from "./usePageImages";
import { useZoom } from "./useZoom";
import { ZoomControls } from "./ZoomControls";
import type { OpenReview } from "./useFindings";
import type { Marks } from "./useMarks";

const THUMBNAILS_ID = "thumbnails";
const MARKS_PANEL_ID = "marks-panel";

/** The side panels' widths in CSS pixels. They outlast one document, so the app keeps them. */
export interface PanelWidths {
  readonly pages: number;
  readonly marks: number;
}

export const initialWidths: PanelWidths = { pages: thumbnailsWidth.initial, marks: marksPanelWidth.initial };

/** The open document's place in the project's review. */
export interface Review {
  /** The document's file name, which its downloads are named after. */
  readonly file: string;
  readonly hidden: readonly HiddenValue[];
  readonly reach: ReadonlyMap<string, Reach>;
  /** The documents whose approval brought this one's new marks. */
  readonly newFrom: readonly string[];
  readonly approved: boolean;
  /** Its marks that no longer match the page, which the user marks again. */
  readonly lost: ReadonlySet<Mark["id"]>;
  readonly onKeepHere: (mark: Mark) => void;
  readonly onDownloaded: () => void;
}

const newInOrder = (marks: readonly Mark[]) =>
  marks
    .filter((mark) => mark.isNew)
    .toSorted((a, b) => firstPage(a.target) - firstPage(b.target) || (a.target.kind === "text" && b.target.kind === "text" ? a.target.pieces[0].start - b.target.pieces[0].start : 0));

const checkedFiles = {
  cleaned: { note: "This is the cleaned file.", download: "Download cleaned PDF", ending: "redacted" },
  preview: { note: "This document isn't approved yet, so this is a preview.", download: "Download preview", ending: "preview" },
} as const;

interface WorkspaceProps {
  readonly session: Session;
  /** The open document. */
  readonly handle: DocumentHandle;
  /** Its cleaned file, shown in place of it while there is one. */
  readonly output: DocumentHandle | undefined;
  /** Whether the PDF worker is ready, so the pages take marks. */
  readonly ready: boolean;
  /** Whether the Session takes changes to the marks: not while approval works out what spreads, or waits for its heads-up. */
  readonly canMark: boolean;
  readonly error: EngineError | undefined;
  /** Hears why a page could not be drawn or read. */
  readonly onFailure: (error: EngineError) => void;
  /** Puts the error away, and with it a refused Preview's highlight. */
  readonly onDismissError: () => void;
  readonly marks: Marks;
  /** The document's open findings review, shown in the marks panel's place. */
  readonly findings: OpenReview | undefined;
  readonly review: Review;
  /** The document's images a box can spread over; undefined until they are read. */
  readonly images: readonly PlacedImage[] | undefined;
  readonly tool: Tool;
  readonly labelling: boolean;
  readonly currentPage: PageIndex | undefined;
  readonly onCurrentPage: (page: PageIndex | undefined) => void;
  readonly onFiles: (files: readonly File[]) => void;
  /** Whether the page thumbnails are shown. */
  readonly showPages: boolean;
  readonly widths: PanelWidths;
  readonly onWidths: (widths: PanelWidths) => void;
  readonly downloadRef: RefObject<HTMLButtonElement | null>;
  readonly onBack: () => void;
}

/** Where a refused Preview points, as its error's data gives it: boxes on one page. */
function refusedBoxes(error: EngineError | undefined): ComponentProps<typeof PageList>["refused"] {
  const page = error?.data?.page;
  const boxes = error?.data?.boxes;
  return typeof page === "number" && typeof boxes === "object" ? { page, boxes } : undefined;
}

/** The page across the middle of the view. */
function pageInMiddle(view: HTMLElement, pages: readonly PageModel[]): PageIndex | undefined {
  const bounds = view.getBoundingClientRect();
  const middle = bounds.top + bounds.height / 2;
  const bottom = (page: PageModel) => document.getElementById(pageFrameId(page.index))?.getBoundingClientRect().bottom ?? 0;
  return pages.find((page) => bottom(page) >= middle)?.index;
}

/** An open document: page list, pages, and marks, or the checked output in preview. */
export function Workspace(props: WorkspaceProps) {
  const { session, handle, output, marks, review, widths, onWidths } = props;
  const { pages } = output ?? handle;
  const viewer = usePageImages(session, handle, output, props.onFailure);
  const source = output === undefined ? "original" : "output";
  const editing = output === undefined && props.ready && props.canMark;
  const shownMarks = output === undefined ? marks.marks : [];
  const zoom = useZoom(pages);
  const checked = checkedFiles[review.approved ? "cleaned" : "preview"];
  const refused = output === undefined ? refusedBoxes(props.error) : undefined;
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      {props.showPages && (
        <>
          <Thumbnails
            id={THUMBNAILS_ID}
            width={widths.pages}
            pages={pages}
            images={viewer.images[source]}
            currentPage={props.currentPage ?? pages[0].index}
            markedPages={new Set(shownMarks.flatMap((mark) => markPages(mark.target)))}
            onVisible={(page) => viewer.show(source, page)}
          />
          <Splitter
            label="Resize the page list"
            panel={THUMBNAILS_ID}
            width={widths.pages}
            limits={thumbnailsWidth}
            grows={1}
            onResize={(width) => onWidths({ ...widths, pages: width })}
          />
        </>
      )}
      <div className="relative flex min-w-0 flex-1">
        <DropZone
          ref={zoom.ref}
          error={errorText(props.error)}
          {...(refused !== undefined && { onDismissError: props.onDismissError })}
          onFiles={props.onFiles}
          onScroll={(event) => props.onCurrentPage(pageInMiddle(event.currentTarget, pages))}
        >
          {output !== undefined && (
            <CheckedBanner
              markCount={marks.marks.length}
              file={checked}
              downloadRef={props.downloadRef}
              onBack={props.onBack}
              onDownload={async () => {
                const bytes = session.output.bytes();
                // The banner says the file could not be saved.
                if (!bytes.ok) throw new Error("The output is out of date");
                if (await savePdf(new Blob([bytes.value], { type: "application/pdf" }), `${baseName(review.file)}-${checked.ending}.pdf`)) review.onDownloaded();
              }}
            />
          )}
          {output === undefined && (
            <ReviewBanner
              marks={newInOrder(marks.marks)}
              from={review.newFrom}
              onShow={(mark) => {
                marks.highlight(mark.id);
                showMark(mark.id);
              }}
            />
          )}
          <PageScale value={zoom.scale}>
            <PageList
              key={source}
              pages={pages}
              images={viewer.images[source]}
              texts={viewer.texts}
              marks={shownMarks}
              findings={output === undefined ? props.findings?.findings : undefined}
              pending={marks.pending}
              highlighted={marks.highlighted}
              tool={editing ? props.tool : undefined}
              typeOptions={marks.typeOptions}
              lastType={marks.lastType}
              onVisible={(page, detail) => viewer.show(source, page, detail)}
              onMark={marks.propose}
              onPick={marks.add}
              onCancel={marks.cancel}
              onHighlight={marks.highlight}
              refused={refused}
            />
          </PageScale>
        </DropZone>
        <ZoomControls zoom={zoom} />
      </div>
      <SidePanel {...props} />
    </div>
  );
}

/** The marks panel at the right, or the findings panel in its place while a findings review is open, and the splitter that resizes it. */
function SidePanel({ marks, review, findings, widths, onWidths, canMark, images, labelling }: WorkspaceProps) {
  const label = findings === undefined ? "Resize the marks panel" : "Resize the found values panel";
  return (
    <>
      <Splitter label={label} panel={MARKS_PANEL_ID} width={widths.marks} limits={marksPanelWidth} grows={-1} onResize={(width) => onWidths({ ...widths, marks: width })} />
      {findings === undefined ? (
        <MarksPanel
          id={MARKS_PANEL_ID}
          width={widths.marks}
          marks={marks.marks}
          canMark={canMark}
          hidden={review.hidden}
          reach={review.reach}
          images={images}
          typeOptions={marks.typeOptions}
          highlighted={marks.highlighted}
          onHighlight={marks.highlight}
          onRemove={marks.remove}
          onRetype={marks.retype}
          onKeepHere={review.onKeepHere}
          lost={review.lost}
          {...(labelling && { onLink: marks.link })}
        />
      ) : (
        <FindingsPanel id={MARKS_PANEL_ID} width={widths.marks} review={findings} />
      )}
    </>
  );
}
