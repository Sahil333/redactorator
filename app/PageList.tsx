import type { KeyboardEvent } from "react";
import type { Box, PageIndex, PageModel, PageText } from "../engine/contract";
import { markPages, type Mark, type MarkTarget, type Pending, type Tool } from "./marks";
import type { MarkType, MarkTypeOption } from "./markTypes";
import { PageView } from "./PageView";
import { PICKER_WIDTH, TypePicker } from "./TypePicker";
import { CSS_PIXELS_PER_POINT } from "./useEngine";
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
  readonly onVisible: (page: PageIndex) => void;
  readonly onMark: (pending: Pending) => void;
  readonly onPick: (type: MarkTypeOption) => void;
  readonly onCancel: () => void;
  readonly onHighlight: (mark: Mark["id"] | undefined) => void;
}

// The type picker keeps this many points clear of the page's right edge.
const PICKER_MARGIN = 10;
const PICKER_POINTS = PICKER_WIDTH / CSS_PIXELS_PER_POINT + PICKER_MARGIN;

function PickerAt({ page, box, ...picker }: { readonly page: PageModel; readonly box: Box } & Parameters<typeof TypePicker>[0]) {
  return (
    <div
      className="absolute z-10"
      style={{
        left: `${Math.min(box.x0, page.width - PICKER_POINTS) * CSS_PIXELS_PER_POINT}px`,
        top: `${(box.y1 + 4) * CSS_PIXELS_PER_POINT}px`,
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
  const selecting = useTextSelection({ pages, tool, texts, onMark: props.onMark, onNeedText: props.onVisible });
  const end = pending && lastBox(pending.target);

  return (
    <div className="flex flex-col items-center-safe gap-6 p-6">
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
          onVisible={() => props.onVisible(page.index)}
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
