import type { AnchorHTMLAttributes } from "react";
import type { PageIndex } from "../engine/model/geometry";
import { pageFrameId, showMark } from "./pageGeometry";

type PageLinkProps = {
  readonly page: PageIndex;
  /** A mark on the page to bring to the middle of the view, instead of the page's top. */
  readonly mark?: number;
} & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "onClick">;

/**
 * A link to a page of the open document. It scrolls the page, or a mark on it, into view and
 * leaves the address alone, because the address names the open project and Back and Forward
 * follow it.
 */
export function PageLink({ page, mark, ...link }: PageLinkProps) {
  const id = pageFrameId(page);
  return (
    <a
      {...link}
      href={`#${id}`}
      onClick={(event) => {
        event.preventDefault();
        if (mark === undefined) document.getElementById(id)?.scrollIntoView();
        else showMark(mark);
      }}
    />
  );
}
