import type { RefObject } from "react";
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
import type { Engine } from "./useEngine";
import { useZoom } from "./useZoom";
import { ZoomControls } from "./ZoomControls";
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
  readonly hidden: readonly HiddenValue[];
  readonly reach: ReadonlyMap<string, Reach>;
  /** The documents whose approval brought this one's new marks. */
  readonly newFrom: readonly string[];
  readonly approved: boolean;
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
  readonly engine: Engine;
  readonly pages: readonly [PageModel, ...PageModel[]];
  readonly marks: Marks;
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

/** The page across the middle of the view. */
function pageInMiddle(view: HTMLElement, pages: readonly PageModel[]): PageIndex | undefined {
  const bounds = view.getBoundingClientRect();
  const middle = bounds.top + bounds.height / 2;
  const bottom = (page: PageModel) => document.getElementById(pageFrameId(page.index))?.getBoundingClientRect().bottom ?? 0;
  return pages.find((page) => bottom(page) >= middle)?.index;
}

/** An open document: page list, pages, and marks, or the checked output in preview. */
export function Workspace(props: WorkspaceProps) {
  const { engine, pages, marks, review, widths, onWidths } = props;
  const { document: opened, output } = engine;
  const source = output === undefined ? "original" : "output";
  const editing = output === undefined && engine.state === "ready";
  const shownMarks = output === undefined ? marks.marks : [];
  const zoom = useZoom(pages);
  const checked = checkedFiles[review.approved ? "cleaned" : "preview"];
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      {props.showPages && (
        <>
          <Thumbnails
            id={THUMBNAILS_ID}
            width={widths.pages}
            pages={pages}
            images={engine.images[source]}
            currentPage={props.currentPage ?? pages[0].index}
            markedPages={new Set(shownMarks.flatMap((mark) => markPages(mark.target)))}
            onVisible={(page) => engine.show(source, page)}
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
          error={engine.error}
          onFiles={props.onFiles}
          onScroll={(event) => props.onCurrentPage(pageInMiddle(event.currentTarget, pages))}
        >
          {output !== undefined && opened !== undefined && (
            <CheckedBanner
              markCount={marks.marks.length}
              file={checked}
              downloadRef={props.downloadRef}
              onBack={props.onBack}
              onDownload={async () => {
                if (await savePdf(new Blob([output.bytes], { type: "application/pdf" }), `${baseName(opened.name)}-${checked.ending}.pdf`)) review.onDownloaded();
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
              images={engine.images[source]}
              texts={engine.texts}
              marks={shownMarks}
              pending={marks.pending}
              highlighted={marks.highlighted}
              tool={editing ? props.tool : undefined}
              typeOptions={marks.typeOptions}
              lastType={marks.lastType}
              onVisible={(page, detail) => engine.show(source, page, detail)}
              onMark={marks.propose}
              onPick={marks.add}
              onCancel={marks.cancel}
              onHighlight={marks.highlight}
            />
          </PageScale>
        </DropZone>
        <ZoomControls zoom={zoom} />
      </div>
      <Splitter
        label="Resize the marks panel"
        panel={MARKS_PANEL_ID}
        width={widths.marks}
        limits={marksPanelWidth}
        grows={-1}
        onResize={(width) => onWidths({ ...widths, marks: width })}
      />
      <MarksPanel
        id={MARKS_PANEL_ID}
        width={widths.marks}
        marks={marks.marks}
        hidden={review.hidden}
        reach={review.reach}
        images={props.images}
        typeOptions={marks.typeOptions}
        highlighted={marks.highlighted}
        onHighlight={marks.highlight}
        onRemove={marks.remove}
        onRetype={marks.retype}
        onKeepHere={review.onKeepHere}
        {...(props.labelling && { onLink: marks.link })}
      />
    </div>
  );
}
