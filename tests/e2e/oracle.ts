import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

/** PDF user space as the outside checker reads it: points, origin bottom-left. */
type UserBox = readonly [number, number, number, number];

type OracleCheck =
  | { readonly check: "absent"; readonly values: readonly string[] }
  | { readonly check: "present"; readonly text: string }
  | { readonly check: "metadata" }
  | { readonly check: "covered"; readonly word: string }
  | { readonly check: "positions"; readonly words: readonly string[] }
  | { readonly check: "pixels"; readonly region: UserBox; readonly mask?: boolean; readonly at?: UserBox }
  | { readonly check: "unchanged"; readonly at: UserBox };

const oracleProject = new URL("../oracle", import.meta.url).pathname;
const datasetProject = new URL("../../tools/dataset", import.meta.url).pathname;

/** Runs a Python tool with uv and throws `failure` with the tool's output if it exits non-zero. */
async function run(project: string, args: readonly string[], failure: string): Promise<void> {
  try {
    await promisify(execFile)("uv", ["run", "--project", project, "python", ...args], { cwd: project });
  } catch (error) {
    const output = error instanceof Error && "stdout" in error && "stderr" in error
      ? `${String(error.stdout)}${String(error.stderr)}`
      : String(error);
    throw new Error(`${failure}:\n${output}`);
  }
}

/** Runs the outside checker (tests/oracle) on an output file and throws its reasons if any check fails. */
export async function judge(input: string, output: string, checks: readonly OracleCheck[]): Promise<void> {
  const spec = join(await mkdtemp(join(tmpdir(), "oracle-")), "spec.json");
  await writeFile(spec, JSON.stringify({ input, output, checks }));
  await run(oracleProject, ["-m", "oracle", spec], "The outside checker failed the output");
}

/** Runs the dataset validator (tools/dataset) on a ground-truth file and throws its problems if any. */
export async function validateTruth(path: string): Promise<void> {
  await run(datasetProject, ["validate.py", path], "The dataset validator rejected the file");
}
