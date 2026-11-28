import * as au from "./au";
import * as ca from "./ca";
import * as finance from "./finance";
import * as inPack from "./in";
import * as legal from "./legal";
import * as medical from "./medical";
import * as uk from "./uk";
import * as universal from "./universal";
import * as us from "./us";

/** A check on a value's letters and digits: true when it passes. It looks nothing up. */
export type Validator = (value: string) => boolean;

/** Every validator a rule can name: each pack's file exports its validators by that name. */
export const validators: Readonly<Record<string, Validator>> = { ...universal, ...us, ...uk, ...inPack, ...ca, ...au, ...finance, ...legal, ...medical };
