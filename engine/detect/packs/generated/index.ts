// Written by hand until slice P0's pack compiler writes it: every compiled pack, by id. The packs
// but universal.json are empty, hand-written placeholders, so a run with any profile loads; P0's
// compiler replaces them all.
import type { PackId } from "../../../model/detection";
import au from "./au.json";
import ca from "./ca.json";
import finance from "./finance.json";
import inPack from "./in.json";
import legal from "./legal.json";
import medical from "./medical.json";
import uk from "./uk.json";
import universal from "./universal.json";
import us from "./us.json";

export const compiledPacks: Readonly<Record<PackId, unknown>> = { universal, us, uk, in: inPack, ca, au, finance, legal, medical };
