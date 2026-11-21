import type { RefObject } from "react";
import type { PageIndex, PageModel } from "../engine/contract";
import { CheckedBanner } from "./CheckedBanner";
import { baseName, download } from "./download";
import { DropZone } from "./DropZone";
import { markPages, type Tool } from "./marks";
import { MarksPanel, marksPanelWidth } from "./MarksPanel";
import { pageFrameId, PageScale } from "./pageGeometry";
import { PageList } from "./PageList";
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

interface WorkspaceProps {
  readonly engine: Engine;
  readonly pages: readonly [PageModel, ...PageModel[]];
  readonly marks: Marks;
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
  const { engine, pages, marks, widths, onWidths } = props;
  const { document: opened, output } = engine;
  const source = output === undefined ? "original" : "output";
  const editing = output === undefined && engine.state === "ready";
  const shownMarks = output === undefined ? marks.marks : [];
  const zoom = useZoom(pages);
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
              downloadRef={props.downloadRef}
              onBack={props.onBack}
              onDownload={() =>
                download(new Blob([output.bytes], { type: "application/pdf" }), `${baseName(opened.name)}-redacted.pdf`)
              }
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
        typeOptions={marks.typeOptions}
        highlighted={marks.highlighted}
        onHighlight={marks.highlight}
        onRemove={marks.remove}
        onRetype={marks.retype}
        {...(props.labelling && { onLink: marks.link })}
      />
    </div>
  );
}
