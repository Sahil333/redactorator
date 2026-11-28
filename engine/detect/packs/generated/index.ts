// Written by hand until slice P0's pack compiler writes it: every compiled pack, by id.
import type { PackId } from "../../../model/detection";
import universal from "./universal.json";

export const compiledPacks: Partial<Readonly<Record<PackId, unknown>>> = { universal };
