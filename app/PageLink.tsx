import type { AnchorHTMLAttributes } from "react";
import type { PageIndex } from "../engine/contract";
import { pageFrameId } from "./pageGeometry";

type PageLinkProps = { readonly page: PageIndex } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "onClick">;

/**
 * A link to a page of the open document. It scrolls the page into view and leaves the address
 * alone, because the address names the open project and Back and Forward follow it.
 */
export function PageLink({ page, ...link }: PageLinkProps) {
  const id = pageFrameId(page);
  return (
    <a
      {...link}
      href={`#${id}`}
      onClick={(event) => {
        event.preventDefault();
        document.getElementById(id)?.scrollIntoView();
      }}
    />
  );
}
