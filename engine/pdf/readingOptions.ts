// How every reading of a PDF's text runs: the app's page text, and the glyphs both checks
// compare. It imports nothing, so tests can use it without loading MuPDF.

/**
 * Drawn letters, not ActualText: preparation removes ActualText, and a tag that reads as other
 * letters would put the app's text out of step with what is drawn.
 */
export const READING_OPTIONS = "preserve-whitespace,ignore-actualtext";
