import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GraphService } from "./graphService.js";
import { withMcpErrors } from "./mcpServer.js";
import {
  AuthStatus,
  AuthToken,
  FetchLike,
  GraphAuthProvider,
  ResponseLike
} from "./types.js";
import { PlanWriteInput } from "./writeGateTypes.js";

const modelVisibleRecords: string[] = [];
const appDataFileSnapshots: string[] = [];
const appDataRoots: string[] = [];
const approvalSecrets: Array<{ url: string; nonce: string }> = [];
const activeHarnesses: Harness[] = [];

const writesToken: AuthToken = {
  accessToken: "writes-token",
  account: "admin@contoso.com",
  tenantId: "tenant-id",
  tenantDomain: "contoso.com",
  activeTenantAlias: "contoso",
  clientId: "workspace-client-id",
  clientIdKind: "workspace",
  credentialMode: "writes",
  grantedScopes: [
    "User.Read.All",
    "Group.Read.All",
    "Policy.Read.All",
    "Organization.Read.All",
    "AuditLog.Read.All",
    "Reports.Read.All",
    "Group.ReadWrite.All"
  ],
  cacheProtection: "keychain",
  writesConfigured: true
};

const readOnlyToken: AuthToken = {
  ...writesToken,
  accessToken: "read-token",
  clientId: "14d82eec-204b-4c2f-b7e8-296a70dab67e",
  clientIdKind: "first-party",
  credentialMode: "read-only",
  writesConfigured: false
};

describe.sequential("write gate acceptance cases", () => {
  afterEach(async () => {
    for (const harness of activeHarnesses.splice(0)) {
      await harness.close();
    }
    vi.useRealTimers();
  });

  it("1. blocks PATCH via graph and executes the same PATCH through an approved plan", async () => {
    const harness = await createHarness();
    harness.fetcher
      .mockResolvedValueOnce(jsonResponse({ accountEnabled: true }))
      .mockResolvedValueOnce(emptyResponse(204));

    const blocked = await harness.call(() => harness.service.graph({
      method: "PATCH",
      path: "/users/1",
      body: {
        accountEnabled: false
      }
    }));
    expect(blocked.isError).toBe(true);
    expect(blocked.payload.error.code).toBe("E_WRITE_BLOCKED");

    const plan = await harness.call(() => harness.service.planWrite(basePlan({
      prefetch: true,
      operations: [
        {
          method: "PATCH",
          path: "/users/1",
          body: {
            accountEnabled: false
          },
          reason: "User offboarded"
        }
      ]
    })));
    await approveBrowser(harness, "approved");
    const approved = await harness.call(() => harness.service.checkPlan({ planId: plan.payload.planId }));
    const executed = await harness.call(() => harness.service.executePlan({
      planId: plan.payload.planId,
      token: approved.payload.token
    }));

    expect(executed.payload.status).toBe("completed");
    expect(executed.payload.results).toMatchObject([
      {
        index: 0,
        status: "success",
        httpStatus: 204
      }
    ]);
    expect(harness.fetcher.mock.calls[0]?.[1]).toMatchObject({ method: "GET" });
    expect(harness.fetcher.mock.calls[1]?.[1]).toMatchObject({ method: "PATCH" });
  });

  it("2. passes all-GET batch and blocks a batch containing an inner PATCH", async () => {
    const harness = await createHarness();
    harness.fetcher.mockResolvedValueOnce(jsonResponse({ responses: [] }));

    const passed = await harness.call(() => harness.service.graph({
      method: "POST",
      path: "/$batch",
      body: {
        requests: Array.from({ length: 10 }, (_value, index) => ({
          id: String(index),
          method: "GET",
          url: "/users"
        }))
      }
    }));
    expect(passed.isError).toBe(false);

    const blocked = await harness.call(() => harness.service.graph({
      method: "POST",
      path: "/$batch",
      body: {
        requests: [
          {
            id: "safe",
            method: "GET",
            url: "/users"
          },
          {
            id: "write",
            method: "PATCH",
            url: "/users/1"
          }
        ]
      }
    }));
    expect(blocked.isError).toBe(true);
    expect(blocked.payload.error).toMatchObject({
      code: "E_WRITE_BLOCKED",
      details: {
        offendingRequestIds: ["write"]
      }
    });
  });

  it("3. rejects a second execute-plan call with the same token", async () => {
    const harness = await createHarness();
    harness.fetcher.mockResolvedValueOnce(emptyResponse(204));
    const approved = await createApprovedPlan(harness);

    const first = await harness.call(() => harness.service.executePlan(approved));
    expect(first.payload.status).toBe("completed");

    const second = await harness.call(() => harness.service.executePlan(approved));
    expect(second.isError).toBe(true);
    expect(second.payload.error.code).toBe("E_PLAN_ALREADY_EXECUTED");
  });

  it("4. expires an approved token after 301 seconds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-04T10:00:00Z"));
    const harness = await createHarness({
      clientInfo: { name: "claude-code", version: "1.0.0" },
      clientCapabilities: { elicitation: {} },
      elicitInput: vi.fn().mockResolvedValue({
        action: "accept",
        content: {
          decision: "approved"
        }
      })
    });

    const plan = await harness.call(() => harness.service.planWrite(basePlan()));
    const approvedPromise = harness.call(() => harness.service.checkPlan({ planId: plan.payload.planId }));
    await flushAsync();
    const approved = await approvedPromise;
    expect(approved.payload.token).toMatch(/^gbt_/);
    await vi.advanceTimersByTimeAsync(301_000);

    const expired = await harness.call(() => harness.service.executePlan({
      planId: plan.payload.planId,
      token: approved.payload.token
    }));
    expect(expired.isError).toBe(true);
    expect(expired.payload.error.code).toBe("E_TOKEN_EXPIRED");

    const check = await harness.call(() => harness.service.checkPlan({ planId: plan.payload.planId }));
    expect(check.payload.status).toBe("expired");
  });

  it("5. times out a pending plan after 601 seconds and deletes the CLI pending file", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-04T10:00:00Z"));
    const harness = await createHarness({ cliApprove: true });

    const plan = await harness.call(() => harness.service.planWrite(basePlan()));
    const pendingPath = join(harness.appDataPath, "pending", `${plan.payload.planId}.json`);
    expect(await fileExists(pendingPath)).toBe(true);
    appDataFileSnapshots.push(await readFile(pendingPath, "utf8"));

    await vi.advanceTimersByTimeAsync(601_000);
    const timedOut = await harness.call(() => harness.service.checkPlan({ planId: plan.payload.planId }));
    expect(timedOut.payload.status).toBe("timed_out");
    expect(await fileExists(pendingPath)).toBe(false);
  });

  it("6. returns a browser rejection reason through check-plan", async () => {
    const harness = await createHarness();
    const plan = await harness.call(() => harness.service.planWrite(basePlan()));

    await approveBrowser(harness, "rejected", "Wrong user");
    const rejected = await harness.call(() => harness.service.checkPlan({ planId: plan.payload.planId }));
    expect(rejected.payload).toEqual({
      status: "rejected",
      reason: "Wrong user"
    });
  });

  it("7. rejects a well-formed but unknown token", async () => {
    const harness = await createHarness();
    const approved = await createApprovedPlan(harness);

    const result = await harness.call(() => harness.service.executePlan({
      planId: approved.planId,
      token: `gbt_${"a".repeat(43)}`
    }));
    expect(result.isError).toBe(true);
    expect(result.payload.error.code).toBe("E_TOKEN_INVALID");
  });

  it("8. rejects a second plan-write while one plan is pending", async () => {
    const harness = await createHarness();
    await harness.call(() => harness.service.planWrite(basePlan()));

    const second = await harness.call(() => harness.service.planWrite(basePlan()));
    expect(second.isError).toBe(true);
    expect(second.payload.error.code).toBe("E_PLAN_PENDING");
  });

  it("9. rejects response references to later operations at intake", async () => {
    const harness = await createHarness();
    const result = await harness.call(() => harness.service.planWrite(basePlan({
      operations: [
        {
          method: "PATCH",
          path: "/groups/{{op[1].response.body.id}}",
          body: {
            displayName: "after"
          },
          reason: "Configure group"
        },
        {
          method: "POST",
          path: "/groups",
          body: {
            displayName: "group"
          },
          reason: "Create group"
        }
      ]
    })));

    expect(result.isError).toBe(true);
    expect(result.payload.error.code).toBe("E_PLAN_INVALID");
    expect(harness.browserUrls).toHaveLength(0);
  });

  it("10. fails unresolved response references and skips the remainder under stopOnError", async () => {
    const harness = await createHarness();
    harness.fetcher.mockResolvedValueOnce(jsonResponse({ id: "group-id" }, 201));
    const approved = await createApprovedPlan(harness, basePlan({
      operations: [
        {
          method: "POST",
          path: "/groups",
          body: {
            displayName: "group"
          },
          reason: "Create group"
        },
        {
          method: "PATCH",
          path: "/groups/{{op[0].response.body.missing}}",
          body: {
            displayName: "renamed"
          },
          reason: "Rename group"
        },
        {
          method: "DELETE",
          path: "/groups/unused",
          reason: "Remove unused group"
        }
      ]
    }));

    const executed = await harness.call(() => harness.service.executePlan(approved));
    expect(executed.payload.status).toBe("partial");
    expect(executed.payload.results).toEqual([
      {
        index: 0,
        status: "success",
        httpStatus: 201,
        body: {
          id: "group-id"
        }
      },
      {
        index: 1,
        status: "failed",
        error: "E_REFERENCE_UNRESOLVED"
      },
      {
        index: 2,
        status: "skipped"
      }
    ]);
  });

  it("11. continues after failures when stopOnError is false", async () => {
    const harness = await createHarness();
    harness.fetcher
      .mockResolvedValueOnce(emptyResponse(204))
      .mockResolvedValueOnce(jsonResponse({
        error: {
          code: "Authorization_RequestDenied",
          message: "Denied"
        }
      }, 403))
      .mockResolvedValueOnce(emptyResponse(204))
      .mockResolvedValueOnce(emptyResponse(204));
    const approved = await createApprovedPlan(harness, basePlan({
      stopOnError: false,
      operations: [
        {
          method: "DELETE",
          path: "/groups/1",
          reason: "Delete group 1"
        },
        {
          method: "DELETE",
          path: "/groups/2",
          reason: "Delete group 2"
        },
        {
          method: "DELETE",
          path: "/groups/3",
          reason: "Delete group 3"
        },
        {
          method: "DELETE",
          path: "/groups/4",
          reason: "Delete group 4"
        }
      ]
    }));

    const executed = await harness.call(() => harness.service.executePlan(approved));
    expect(executed.payload.status).toBe("partial");
    expect(executed.payload.results.map((result: { status: string }) => result.status)).toEqual([
      "success",
      "failed",
      "success",
      "success"
    ]);
  });

  it("12. voids pending state across restart while preserving created audit only", async () => {
    const first = await createHarness();
    const plan = await first.call(() => first.service.planWrite(basePlan()));
    await first.close();

    const second = await createHarness({ appDataPath: first.appDataPath });
    const missing = await second.call(() => second.service.checkPlan({ planId: plan.payload.planId }));
    expect(missing.isError).toBe(true);
    expect(missing.payload.error.code).toBe("E_PLAN_NOT_FOUND");

    const execute = await second.call(() => second.service.executePlan({
      planId: plan.payload.planId,
      token: `gbt_${"b".repeat(43)}`
    }));
    expect(execute.isError).toBe(true);
    expect(execute.payload.error.code).toBe("E_TOKEN_INVALID");

    const auditText = await readTree(join(first.appDataPath, "audit"));
    expect(auditText).toContain("\"event\":\"created\"");
    expect(auditText).not.toContain("\"event\":\"decided\"");
  });

  it("13. refuses a replayed browser decision with the same nonce after approval", async () => {
    const harness = await createHarness();
    const plan = await harness.call(() => harness.service.planWrite(basePlan()));
    const url = harness.latestBrowserUrl();

    await postDecision(url, "approved");
    const replay = await postDecisionMaybe(url, "rejected");
    expect(replay).toBe(false);

    const approved = await harness.call(() => harness.service.checkPlan({ planId: plan.payload.planId }));
    expect(approved.payload.status).toBe("approved");
    expect(approved.payload.token).toMatch(/^gbt_/);
  });

  it("14. allows page reloads before accepting one browser decision", async () => {
    const harness = await createHarness();
    const plan = await harness.call(() => harness.service.planWrite(basePlan()));
    const url = harness.latestBrowserUrl();

    const firstLoad = await fetch(url);
    const secondLoad = await fetch(url);
    expect(firstLoad.status).toBe(200);
    expect(secondLoad.status).toBe(200);

    await postDecision(url, "approved");
    const approved = await harness.call(() => harness.service.checkPlan({ planId: plan.payload.planId }));
    expect(approved.payload.status).toBe("approved");
  });

  it("15. rejects plan-write when writes are not configured and creates no plan state", async () => {
    const harness = await createHarness({ writesConfigured: false });
    const result = await harness.call(() => harness.service.planWrite(basePlan()));

    expect(result.isError).toBe(true);
    expect(result.payload.error.code).toBe("E_WRITES_NOT_CONFIGURED");
    expect(harness.browserUrls).toHaveLength(0);
  });

  it("16. delivers an approved token exactly once", async () => {
    const harness = await createHarness();
    const plan = await harness.call(() => harness.service.planWrite(basePlan()));
    await approveBrowser(harness, "approved");

    const first = await harness.call(() => harness.service.checkPlan({ planId: plan.payload.planId }));
    const second = await harness.call(() => harness.service.checkPlan({ planId: plan.payload.planId }));

    expect(first.payload.token).toMatch(/^gbt_/);
    expect(second.payload).toEqual({
      status: "approved",
      tokenDelivered: true
    });
  });

  it("17. falls through from elicitation cancel to browser without changing the deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-04T10:00:00Z"));
    const harness = await createHarness({
      clientInfo: { name: "claude-code", version: "1.0.0" },
      clientCapabilities: { elicitation: {} },
      elicitInput: vi.fn().mockResolvedValue({
        action: "cancel"
      })
    });

    const plan = await harness.call(() => harness.service.planWrite(basePlan()));
    await flushAsync();
    expect(harness.browserUrls).toHaveLength(1);

    const checkPromise = harness.call(() => harness.service.checkPlan({ planId: plan.payload.planId }));
    await vi.advanceTimersByTimeAsync(55_000);
    const check = await checkPromise;
    expect(check.payload).toEqual({
      status: "awaiting_approval",
      approvalDeadline: plan.payload.approvalDeadline
    });
  });

  it("18. skips elicitation for non-allowlisted clients even when capability is present", async () => {
    const elicitInput = vi.fn().mockResolvedValue({
      action: "accept",
      content: {
        decision: "approved"
      }
    });
    const harness = await createHarness({
      clientInfo: { name: "other-client", version: "1.0.0" },
      clientCapabilities: { elicitation: {} },
      elicitInput
    });

    await harness.call(() => harness.service.planWrite(basePlan()));
    expect(elicitInput).not.toHaveBeenCalled();
    expect(harness.browserUrls).toHaveLength(1);
  });

  it("marks a consumed plan failed when execute-plan cannot acquire a writes token", async () => {
    const harness = await createHarness({
      auth: new ThrowOnExecuteAuth(writesToken)
    });
    const approved = await createApprovedPlan(harness);

    const execute = await harness.call(() => harness.service.executePlan(approved));
    expect(execute.isError).toBe(true);
    expect(execute.payload.error).toMatchObject({
      code: "graph-request-failed",
      message: "execute auth unavailable"
    });

    const check = await harness.call(() => harness.service.checkPlan({ planId: approved.planId }));
    expect(check.payload).toEqual({
      status: "failed",
      results: []
    });
  });

  it("omits body and Content-Type for a bodyless POST replay", async () => {
    const harness = await createHarness();
    harness.fetcher.mockResolvedValueOnce(emptyResponse(204));
    const approved = await createApprovedPlan(harness, basePlan({
      operations: [
        {
          method: "POST",
          path: "/users/1/revokeSignInSessions",
          reason: "Revoke sessions"
        }
      ]
    }));

    const executed = await harness.call(() => harness.service.executePlan(approved));
    expect(executed.payload.status).toBe("completed");
    const replayInit = harness.fetcher.mock.calls[0]?.[1];
    expect(replayInit).toMatchObject({
      method: "POST"
    });
    expect(replayInit?.body).toBeUndefined();
    expect(headerValue(replayInit?.headers, "Content-Type")).toBeUndefined();
  });

  it("preflights and reacquires the exact approved scope set", async () => {
    const auth = new CapturingAuth(writesToken);
    const harness = await createHarness({ auth });
    harness.fetcher.mockResolvedValueOnce(emptyResponse(204));
    const approved = await createApprovedPlan(harness, basePlan({
      requiredScopes: ["Group.ReadWrite.All"]
    }));
    await harness.call(() => harness.service.executePlan(approved));

    expect(auth.requestedScopes).toEqual([
      ["Group.ReadWrite.All"],
      ["Group.ReadWrite.All"]
    ]);
  });

  it("rejects missing plan scopes before opening approval", async () => {
    const token = {
      ...writesToken,
      grantedScopes: writesToken.grantedScopes.filter((scope) => scope !== "Group.ReadWrite.All")
    };
    const harness = await createHarness({ auth: new MockAuth(token) });

    const result = await harness.call(() => harness.service.planWrite(basePlan()));

    expect(result.payload.error).toMatchObject({
      code: "E_PLAN_SCOPE_MISSING",
      details: { missingScopes: ["Group.ReadWrite.All"] }
    });
    expect(harness.browserUrls).toHaveLength(0);
  });

  it("returns structured MCP content while retaining text compatibility", async () => {
    const result = await withMcpErrors(async () => ({ status: "ok", count: 2 }));

    expect(result.structuredContent).toEqual({ status: "ok", count: 2 });
    expect(result.content[0]).toEqual({
      type: "text",
      text: JSON.stringify({ status: "ok", count: 2 }, null, 2)
    });
  });

  it("19. leaks no approval URL or nonce through model-visible records or appdata files", async () => {
    expect(approvalSecrets.length).toBeGreaterThan(0);

    for (const record of modelVisibleRecords) {
      for (const secret of approvalSecrets) {
        expect(record).not.toContain(secret.url);
        expect(record).not.toContain(secret.nonce);
      }
    }

    const files = [
      ...appDataFileSnapshots,
      ...await Promise.all(appDataRoots.map((root) => readTree(root)))
    ];
    for (const fileText of files) {
      for (const secret of approvalSecrets) {
        expect(fileText).not.toContain(secret.url);
        expect(fileText).not.toContain(secret.nonce);
      }
    }
  });
});

class MockAuth implements GraphAuthProvider {
  private readonly token: AuthToken;
  private readonly status: AuthStatus;

  constructor(token: AuthToken) {
    this.token = token;
    this.status = {
      signedIn: true,
      account: token.account,
      tenantId: token.tenantId,
      tenantDomain: token.tenantDomain,
      activeTenantAlias: token.activeTenantAlias,
      credentialMode: token.credentialMode,
      clientId: token.clientId,
      clientIdKind: token.clientIdKind,
      grantedScopes: token.grantedScopes,
      entraP1: true,
      directoryRoles: ["Global Reader"],
      directoryRolesStatus: { state: "available" },
      cacheProtection: token.cacheProtection,
      gate: {
        pendingPlan: null,
        writesConfigured: token.writesConfigured
      }
    };
  }

  async getToken(_scopes: string[]): Promise<AuthToken> {
    return this.token;
  }

  async getStatus(): Promise<AuthStatus> {
    return this.status;
  }

  async addScopes(input: { scopes: string[]; reason: string }) {
    return {
      granted: true,
      alreadyGranted: [],
      requestedScopes: input.scopes,
      grantedScopes: [...this.token.grantedScopes, ...input.scopes]
    };
  }
}

class ThrowOnExecuteAuth extends MockAuth {
  private getTokenCalls = 0;

  override async getToken(): Promise<AuthToken> {
    this.getTokenCalls += 1;
    if (this.getTokenCalls > 1) {
      throw new Error("execute auth unavailable");
    }

    return super.getToken();
  }
}

class CapturingAuth extends MockAuth {
  readonly requestedScopes: string[][] = [];

  override async getToken(scopes: string[]): Promise<AuthToken> {
    this.requestedScopes.push([...scopes]);
    return super.getToken();
  }
}

class Harness {
  readonly service: GraphService;
  readonly fetcher: ReturnType<typeof vi.fn<FetchLike>>;
  readonly browserUrls: string[] = [];

  constructor(readonly appDataPath: string, params: {
    token: AuthToken;
    auth?: GraphAuthProvider;
    fetcher: ReturnType<typeof vi.fn<FetchLike>>;
    clientInfo?: { name: string; version: string; title?: string };
    clientCapabilities?: { elicitation?: unknown };
    elicitInput?: (params: unknown) => Promise<{ action: "accept" | "decline" | "cancel"; content?: Record<string, string> }>;
  }) {
    this.fetcher = params.fetcher;
    this.service = new GraphService({
      auth: params.auth ?? new MockAuth(params.token),
      fetcher: params.fetcher,
      appDataPath,
      browserOpen: async (url) => {
        this.browserUrls.push(url);
        approvalSecrets.push({
          url,
          nonce: new URL(url).searchParams.get("k") ?? ""
        });
      },
      clientContext: () => ({
        clientInfo: params.clientInfo,
        clientCapabilities: params.clientCapabilities,
        elicitInput: params.elicitInput as never
      })
    });
  }

  async call(operation: () => Promise<unknown>) {
    const result = await withMcpErrors(operation);
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";
    modelVisibleRecords.push(text);
    return {
      isError: result.isError === true,
      payload: JSON.parse(text)
    };
  }

  latestBrowserUrl(): string {
    const url = this.browserUrls.at(-1);
    if (!url) {
      throw new Error("Expected browser URL.");
    }

    return url;
  }

  async close(): Promise<void> {
    await this.service.close();
  }
}

async function createHarness(options: {
  writesConfigured?: boolean;
  cliApprove?: boolean;
  appDataPath?: string;
  auth?: GraphAuthProvider;
  clientInfo?: { name: string; version: string; title?: string };
  clientCapabilities?: { elicitation?: unknown };
  elicitInput?: (params: unknown) => Promise<{ action: "accept" | "decline" | "cancel"; content?: Record<string, string> }>;
} = {}): Promise<Harness> {
  const appDataPath = options.appDataPath ?? await tempAppData();
  appDataRoots.push(appDataPath);
  await mkdir(appDataPath, { recursive: true });
  await writeFile(join(appDataPath, "config.json"), JSON.stringify({
    requestedWriteScopes: ["Group.ReadWrite.All"],
    ...(options.cliApprove ? {
      gate: {
        cliApprove: true
      }
    } : {})
  }), {
    encoding: "utf8",
    mode: 0o600
  });

  const harness = new Harness(appDataPath, {
    token: options.writesConfigured === false ? readOnlyToken : writesToken,
    auth: options.auth,
    fetcher: vi.fn<FetchLike>(),
    clientInfo: options.clientInfo,
    clientCapabilities: options.clientCapabilities,
    elicitInput: options.elicitInput
  });
  activeHarnesses.push(harness);
  return harness;
}

async function createApprovedPlan(harness: Harness, input: PlanWriteInput = basePlan()) {
  const plan = await harness.call(() => harness.service.planWrite(input));
  await approveBrowser(harness, "approved");
  const approved = await harness.call(() => harness.service.checkPlan({ planId: plan.payload.planId }));
  return {
    planId: plan.payload.planId,
    token: approved.payload.token
  };
}

function basePlan(overrides: Partial<PlanWriteInput> = {}): PlanWriteInput {
  return {
    summary: "Apply approved test change",
    rollback: "Reverse the test change",
    requiredScopes: ["Group.ReadWrite.All"],
    stopOnError: true,
    prefetch: false,
    operations: [
      {
        method: "DELETE",
        path: "/groups/1",
        reason: "Remove test group"
      }
    ],
    ...overrides
  };
}

async function approveBrowser(harness: Harness, decision: "approved" | "rejected", reason = ""): Promise<void> {
  await postDecision(harness.latestBrowserUrl(), decision, reason);
}

async function postDecision(url: string, decision: "approved" | "rejected", reason = ""): Promise<Response> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      decision,
      reason
    })
  });
  expect(response.ok).toBe(true);
  return response;
}

async function postDecisionMaybe(url: string, decision: "approved" | "rejected"): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        decision
      })
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function tempAppData(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "greybeard-write-gate-"));
  await mkdir(root, { recursive: true });
  return root;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readTree(path: string): Promise<string> {
  if (!await fileExists(path)) {
    return "";
  }

  const info = await stat(path);
  if (info.isFile()) {
    return readFile(path, "utf8");
  }

  const children = await readdir(path);
  const contents = await Promise.all(children.map((child) => readTree(join(path, child))));
  return contents.join("\n");
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): ResponseLike {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: statusText(status),
    headers: {
      get(name: string) {
        const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
        return key ? headers[key] ?? null : null;
      }
    },
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    }
  };
}

function emptyResponse(status: number): ResponseLike {
  return jsonResponse(null, status);
}

function headerValue(headers: HeadersInit | undefined, name: string): string | undefined {
  if (!headers || Array.isArray(headers) || headers instanceof Headers) {
    return undefined;
  }

  const match = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return typeof match?.[1] === "string" ? match[1] : undefined;
}

function statusText(status: number): string {
  if (status === 200) {
    return "OK";
  }

  if (status === 201) {
    return "Created";
  }

  if (status === 204) {
    return "No Content";
  }

  if (status === 403) {
    return "Forbidden";
  }

  return String(status);
}
