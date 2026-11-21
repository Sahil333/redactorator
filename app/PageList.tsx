import type { KeyboardEvent } from "react";
import type { Box, PageIndex, PageModel, PageText } from "../engine/contract";
import { markPages, type Mark, type MarkTarget, type Pending, type Tool } from "./marks";
import type { MarkType, MarkTypeOption } from "./markTypes";
import { PageView } from "./PageView";
import { PICKER_WIDTH, TypePicker } from "./TypePicker";
import type { RenderDetail } from "./useEngine";
import { useTextSelection } from "./useTextSelection";

interface PageListProps {
  readonly pages: readonly PageModel[];
  readonly images: ReadonlyMap<PageIndex, ImageData>;
  readonly texts: ReadonlyMap<PageIndex, PageText>;
  readonly marks: readonly Mark[];
  readonly pending: Pending | undefined;
  readonly highlighted: Mark["id"] | undefined;
  /** Undefined while the pages take no marks: in the preview, or while the engine is busy. */
  readonly tool: Tool | undefined;
  readonly typeOptions: readonly MarkTypeOption[];
  readonly lastType: MarkType;
  readonly onVisible: (page: PageIndex, detail: RenderDetail) => void;
  readonly onMark: (pending: Pending) => void;
  readonly onPick: (type: MarkTypeOption) => void;
  readonly onCancel: () => void;
  readonly onHighlight: (mark: Mark["id"] | undefined) => void;
}

/** The space around the pages, in CSS pixels. Fitting a page to the pane leaves it free. */
export const PAGE_LIST_PADDING = 24;

// The type picker keeps this many CSS pixels clear of the page's right edge.
const PICKER_MARGIN = 13;

function PickerAt({ page, box, ...picker }: { readonly page: PageModel; readonly box: Box } & Parameters<typeof TypePicker>[0]) {
  return (
    <div
      className="absolute z-10 mt-1.5"
      style={{
        left: `max(0px, min(${(box.x0 / page.width) * 100}%, 100% - ${PICKER_WIDTH + PICKER_MARGIN}px))`,
        top: `${(box.y1 / page.height) * 100}%`,
      }}
    >
      <TypePicker {...picker} />
    </div>
  );
}

/** Where a new mark ends: the type picker opens under its last box. */
function lastBox(target: MarkTarget): { readonly page: PageIndex; readonly box: Box } | undefined {
  if (target.kind === "box") return target;
  const piece = target.pieces.at(-1);
  const box = piece?.boxes.at(-1);
  return piece && box && { page: piece.page, box };
}

/** Every page of the document, the marks on them, and the type picker for a new mark. */
export function PageList(props: PageListProps) {
  const { pages, images, texts, marks, pending, highlighted, tool, typeOptions, lastType } = props;
  const selecting = useTextSelection({ pages, tool, texts, onMark: props.onMark, onNeedText: (page) => props.onVisible(page, 1) });
  const end = pending && lastBox(pending.target);

  return (
    <div className="flex flex-col items-center-safe gap-6" style={{ padding: PAGE_LIST_PADDING }}>
      {pages.map((page) => (
        <PageView
          key={page.index}
          page={page}
          image={images.get(page.index)}
          marks={marks.filter((mark) => markPages(mark.target).includes(page.index))}
          pending={pending}
          highlighted={highlighted}
          tool={tool}
          text={selecting.onPage(page.index)}
          onVisible={(detail) => props.onVisible(page.index, detail)}
          onMark={(target) => props.onMark({ target, selection: undefined })}
          onHighlight={props.onHighlight}
        >
          {end?.page === page.index && (
            <PickerAt
              page={page}
              box={end.box}
              options={typeOptions}
              initial={lastType}
              onPick={props.onPick}
              onCancel={props.onCancel}
              {...(pending?.selection && { onAdjust: (event: KeyboardEvent) => selecting.adjust(pending, event) })}
            />
          )}
        </PageView>
      ))}
    </div>
  );
}
