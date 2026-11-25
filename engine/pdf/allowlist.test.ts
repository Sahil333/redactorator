// The structural check's cases that only check mode reaches: strip mode removes or refuses them
// first, so no leak entry can show them (docs/designs/pdf-leak-suite.md, Detailed item 30).
import * as mupdf from "mupdf";
import { describe, expect, test } from "vitest";
import { keyOutsideAllowlist } from "./allowlist";

/** A one-page document whose page draws one image, its stream dictionary given. */
function withImage(image: Record<string, unknown>): mupdf.PDFDocument {
  const document = new mupdf.PDFDocument();
  const stream = document.addRawStream("raw image data", { Type: "XObject", Subtype: "Image", Width: 1, Height: 1, BitsPerComponent: 8, ColorSpace: "DeviceGray", ...image });
  const resources = document.addObject({ XObject: { Im: stream } });
  document.insertPage(-1, document.addPage([0, 0, 612, 792], 0, resources, "q 100 0 0 100 0 0 cm /Im Do Q"));
  // A new document's catalog holds an Info of MuPDF's own.
  document.getTrailer().get("Root").delete("Info");
  return document;
}

describe("check mode", () => {
  test("passes the same file with nothing left over", () => {
    const document = withImage({});
    expect(keyOutsideAllowlist(document)).toBeUndefined();
    document.destroy();
  });

  test("reports a lossless filter left ahead of image data, which strip mode always undoes", () => {
    const document = withImage({ Filter: ["FlateDecode", "DCTDecode"] });
    expect(keyOutsideAllowlist(document)).toBe("trailer/Root/Pages/Kids[0]/Resources/XObject/Im (a filter over image data)");
    document.destroy();
  });

  test("reports an Encrypt left in the trailer, which strip mode keeps until step 8's save drops it", () => {
    const document = withImage({});
    document.getTrailer().put("Encrypt", document.newDictionary());
    expect(keyOutsideAllowlist(document)).toBe("trailer/Encrypt");
    document.destroy();
  });
});
