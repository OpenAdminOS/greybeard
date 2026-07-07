import { createInterface } from "node:readline/promises";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  getGreybeardAppDataPath,
  readGreybeardConfig
} from "@greybeard/graph";
import { flagValue, ParsedArgs } from "./args.js";
import { CliRuntime, writeLine } from "./runtime.js";

type PendingPlanFile = {
  path: string;
  planId: string;
  loopbackPort: number;
  rendered: string;
  approvalDeadline?: string;
};

export async function runApprove(args: ParsedArgs, runtime: CliRuntime): Promise<number> {
  if (!runtime.stdin.isTTY) {
    writeLine(runtime.stderr, "greybeard approve requires an interactive TTY.");
    return 1;
  }

  const appDataPath = flagValue(args, "app-data") || runtime.env.GREYBEARD_APP_DATA || getGreybeardAppDataPath();
  const config = await readGreybeardConfig(appDataPath);
  const pending = await listPendingPlans(appDataPath);

  if (pending.length === 0) {
    writeLine(runtime.stdout, config.gate?.cliApprove === true
      ? "No pending CLI approval files found."
      : "No pending CLI approval files found. This command is only meaningful when gate.cliApprove is true.");
    return 0;
  }

  writeLine(runtime.stdout, "Pending plans:");
  for (const item of pending) {
    writeLine(runtime.stdout, `- ${item.planId} (${item.path})`);
  }
  writeLine(runtime.stdout, "");

  const plan = selectPlan(args, pending);
  writeLine(runtime.stdout, `Pending plan: ${plan.planId}`);
  if (plan.approvalDeadline) {
    writeLine(runtime.stdout, `Approval deadline: ${plan.approvalDeadline}`);
  }
  writeLine(runtime.stdout, "");
  writeLine(runtime.stdout, plan.rendered);
  writeLine(runtime.stdout, "");

  const scriptedDecision = flagValue(args, "decision") || runtime.env.GREYBEARD_APPROVE_DECISION;
  const scriptedReason = flagValue(args, "reason") || runtime.env.GREYBEARD_APPROVE_REASON;
  const decision = normalizeDecision(scriptedDecision) ?? await promptDecision(runtime);
  const reason = scriptedReason ?? await promptReason(runtime);
  await postDecision(runtime, plan, decision, reason);
  writeLine(runtime.stdout, `Decision recorded: ${decision}`);
  return 0;
}

export async function listPendingPlans(appDataPath: string): Promise<PendingPlanFile[]> {
  const pendingDir = join(appDataPath, "pending");
  let names: string[];
  try {
    names = await readdir(pendingDir);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }

  const plans: PendingPlanFile[] = [];
  for (const name of names.filter((entry) => entry.endsWith(".json")).sort()) {
    const path = join(pendingDir, name);
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!isObject(parsed)) {
      continue;
    }

    const planId = typeof parsed.planId === "string" ? parsed.planId : name.replace(/\.json$/u, "");
    const loopbackPort = typeof parsed.loopbackPort === "number" ? parsed.loopbackPort : Number(parsed.loopbackPort);
    const rendered = typeof parsed.rendered === "string" ? parsed.rendered : "";
    if (!planId || !Number.isInteger(loopbackPort) || loopbackPort <= 0 || !rendered) {
      continue;
    }

    plans.push({
      path,
      planId,
      loopbackPort,
      rendered,
      approvalDeadline: typeof parsed.approvalDeadline === "string" ? parsed.approvalDeadline : undefined
    });
  }

  return plans;
}

function selectPlan(args: ParsedArgs, pending: PendingPlanFile[]): PendingPlanFile {
  const requested = flagValue(args, "plan-id");
  if (!requested) {
    return pending[0] as PendingPlanFile;
  }

  const match = pending.find((plan) => plan.planId === requested);
  if (!match) {
    throw new Error(`No pending plan file found for ${requested}.`);
  }

  return match;
}

async function promptDecision(runtime: CliRuntime): Promise<"approved" | "rejected"> {
  const rl = createInterface({
    input: runtime.stdin,
    output: runtime.stdout as NodeJS.WritableStream
  });
  try {
    while (true) {
      const answer = (await rl.question("Approve or reject? [approve/reject] ")).trim().toLowerCase();
      const decision = normalizeDecision(answer);
      if (decision) {
        return decision;
      }
      writeLine(runtime.stdout, "Enter approve or reject.");
    }
  } finally {
    rl.close();
  }
}

async function promptReason(runtime: CliRuntime): Promise<string> {
  const rl = createInterface({
    input: runtime.stdin,
    output: runtime.stdout as NodeJS.WritableStream
  });
  try {
    return await rl.question("Reason or note (optional): ");
  } finally {
    rl.close();
  }
}

function normalizeDecision(value: string | undefined): "approved" | "rejected" | null {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "approve" || normalized === "approved" || normalized === "a") {
    return "approved";
  }

  if (normalized === "reject" || normalized === "rejected" || normalized === "r") {
    return "rejected";
  }

  return null;
}

async function postDecision(
  runtime: CliRuntime,
  plan: PendingPlanFile,
  decision: "approved" | "rejected",
  reason: string
): Promise<void> {
  const response = await runtime.fetcher(`http://127.0.0.1:${plan.loopbackPort}/cli/plan/${encodeURIComponent(plan.planId)}/decision`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      decision,
      reason
    })
  });

  if (!response.ok) {
    throw new Error(`Decision endpoint returned HTTP ${response.status}: ${await response.text()}`);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
