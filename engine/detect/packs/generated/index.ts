// Written by tools/packs/compile.ts from engine/detect/packs/src and lists: run `pnpm packs`, never edit by hand.
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
import inBankCodes from "./lists/in-bank-codes.json";
import inUpiHandles from "./lists/in-upi-handles.json";
import inVehicleStateCodes from "./lists/in-vehicle-state-codes.json";
import topLevelDomains from "./lists/top-level-domains.json";
import usCourtCaseTypes from "./lists/us-court-case-types.json";
import usEinPrefixes from "./lists/us-ein-prefixes.json";

/** Every compiled pack, by id. */
export const compiledPacks: Readonly<Record<PackId, unknown>> = { universal, us, uk, in: inPack, ca, au, finance, legal, medical };

/** Every compiled list, by name. */
export const compiledLists: Readonly<Record<string, unknown>> = { "in-bank-codes": inBankCodes, "in-upi-handles": inUpiHandles, "in-vehicle-state-codes": inVehicleStateCodes, "top-level-domains": topLevelDomains, "us-court-case-types": usCourtCaseTypes, "us-ein-prefixes": usEinPrefixes };
