import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes as nodeRandomBytes } from "node:crypto";
import { RenderedPlan } from "./planRendering.js";
import { ApprovalDecision } from "./writeGateTypes.js";

export type BrowserOpen = (url: string) => Promise<void>;

export type ElicitInput = (params: {
  mode: "form";
  message: string;
  requestedSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}) => Promise<{
  action: "accept" | "decline" | "cancel";
  content?: Record<string, string | number | boolean | string[]>;
}>;

export type ApprovalClientContext = {
  clientInfo?: {
    name?: string;
    title?: string;
    version?: string;
  };
  clientCapabilities?: {
    elicitation?: unknown;
  };
  elicitInput?: ElicitInput;
};

export class ApprovalChannelHandle {
  readonly channels = new Set<"elicitation" | "browser" | "cli">();
  private server?: Server;
  private pendingFilePath?: string;
  private closed = false;

  setServer(server: Server): void {
    this.server = server;
  }

  setPendingFile(path: string): void {
    this.pendingFilePath = path;
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.closed = true;
    const server = this.server;
    this.server = undefined;
    if (server) {
      await closeServer(server);
    }

    if (this.pendingFilePath) {
      await rm(this.pendingFilePath, { force: true });
      this.pendingFilePath = undefined;
    }
  }
}

export class ApprovalChannelCoordinator {
  private readonly appDataPath: string;
  private readonly browserOpen: BrowserOpen;
  private readonly stderr: Pick<NodeJS.WriteStream, "write">;
  private readonly randomBytes: (size: number) => Buffer;
  private readonly clientContext: () => ApprovalClientContext;

  constructor(params: {
    appDataPath: string;
    browserOpen?: BrowserOpen;
    stderr?: Pick<NodeJS.WriteStream, "write">;
    randomBytes?: (size: number) => Buffer;
    clientContext?: () => ApprovalClientContext;
  }) {
    this.appDataPath = params.appDataPath;
    this.browserOpen = params.browserOpen ?? openDefaultBrowser;
    this.stderr = params.stderr ?? process.stderr;
    this.randomBytes = params.randomBytes ?? nodeRandomBytes;
    this.clientContext = params.clientContext ?? (() => ({}));
  }

  async establish(params: {
    planId: string;
    rendered: RenderedPlan;
    cliApprove: boolean;
    onDecision: (decision: ApprovalDecision) => Promise<void>;
    isAwaiting: () => boolean;
  }): Promise<ApprovalChannelHandle | null> {
    const handle = new ApprovalChannelHandle();
    const context = this.clientContext();

    if (canUseElicitation(context)) {
      handle.channels.add("elicitation");
      void this.runElicitation({
        handle,
        ...params,
        elicitInput: context.elicitInput
      });
      return handle;
    }

    const opened = await this.establishBrowser({
      handle,
      ...params
    });
    return opened ? handle : null;
  }

  private async runElicitation(params: {
    handle: ApprovalChannelHandle;
    planId: string;
    rendered: RenderedPlan;
    cliApprove: boolean;
    elicitInput: ElicitInput;
    onDecision: (decision: ApprovalDecision) => Promise<void>;
    isAwaiting: () => boolean;
  }): Promise<void> {
    try {
      const result = await params.elicitInput({
        mode: "form",
        message: params.rendered.text,
        requestedSchema: {
          type: "object",
          properties: {
            decision: {
              type: "string",
              enum: ["approved", "rejected"],
              default: "approved"
            },
            reason: {
              type: "string",
              maxLength: 2000
            }
          },
          required: ["decision"]
        }
      });

      if (!params.isAwaiting()) {
        return;
      }

      if (result.action === "cancel") {
        await this.establishBrowser(params);
        return;
      }

      if (result.action === "decline") {
        await params.onDecision({
          decision: "rejected",
          reason: reasonFromContent(result.content),
          channel: "elicitation"
        });
        return;
      }

      const decision = result.content?.decision === "rejected" ? "rejected" : "approved";
      await params.onDecision({
        decision,
        reason: reasonFromContent(result.content),
        channel: "elicitation"
      });
    } catch {
      if (params.isAwaiting()) {
        await this.establishBrowser(params);
      }
    }
  }

  private async establishBrowser(params: {
    handle: ApprovalChannelHandle;
    planId: string;
    rendered: RenderedPlan;
    cliApprove: boolean;
    onDecision: (decision: ApprovalDecision) => Promise<void>;
    isAwaiting: () => boolean;
  }): Promise<boolean> {
    const nonce = this.randomBytes(16).toString("base64url");
    const server = createServer();
    let acceptedDecision = false;

    server.on("request", (request, response) => {
      void this.routeRequest({
        request,
        response,
        planId: params.planId,
        rendered: params.rendered,
        nonce: acceptedDecision ? undefined : nonce,
        cliApprove: params.cliApprove,
        isAwaiting: params.isAwaiting,
        acceptDecision: async (decision) => {
          if (acceptedDecision || !params.isAwaiting()) {
            writeText(response, 409, "Decision refused.");
            return;
          }

          acceptedDecision = true;
          await params.onDecision(decision);
          writeText(response, 200, "Decision recorded.");
          setImmediate(() => {
            void params.handle.close();
          });
        }
      });
    });

    try {
      await listen(server);
    } catch {
      return false;
    }

    const port = serverPort(server);
    params.handle.setServer(server);
    params.handle.channels.add("browser");
    if (params.cliApprove) {
      const pendingPath = join(this.appDataPath, "pending", `${params.planId}.json`);
      await mkdir(dirname(pendingPath), { recursive: true });
      await writeFile(pendingPath, JSON.stringify({
        ...params.rendered.pendingFile,
        loopbackPort: port,
        rendered: params.rendered.text
      }, null, 2), {
        encoding: "utf8",
        mode: 0o600
      });
      params.handle.setPendingFile(pendingPath);
      params.handle.channels.add("cli");
    }

    const url = `http://127.0.0.1:${port}/plan/${encodeURIComponent(params.planId)}?k=${encodeURIComponent(nonce)}`;
    try {
      await this.browserOpen(url);
    } catch {
      this.stderr.write(`Greybeard approval page: ${url}\n`);
    }

    return true;
  }

  private async routeRequest(params: {
    request: IncomingMessage;
    response: ServerResponse;
    planId: string;
    rendered: RenderedPlan;
    nonce?: string;
    cliApprove: boolean;
    isAwaiting: () => boolean;
    acceptDecision: (decision: ApprovalDecision) => Promise<void>;
  }): Promise<void> {
    const url = requestUrl(params.request);
    if (!url) {
      writeText(params.response, 404, "Not found.");
      return;
    }

    if (!params.isAwaiting()) {
      writeText(params.response, 409, "Plan is no longer awaiting approval.");
      return;
    }

    if (params.request.method === "GET" && url.pathname === `/plan/${params.planId}`) {
      if (!params.nonce || url.searchParams.get("k") !== params.nonce) {
        writeText(params.response, 404, "Not found.");
        return;
      }

      params.response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store"
      });
      params.response.end(params.rendered.htmlBody);
      return;
    }

    if (params.request.method === "POST" && url.pathname === `/plan/${params.planId}`) {
      if (!params.nonce || url.searchParams.get("k") !== params.nonce) {
        writeText(params.response, 403, "Decision refused.");
        return;
      }

      const form = await readDecisionBody(params.request);
      await params.acceptDecision({
        decision: form.decision === "rejected" ? "rejected" : "approved",
        reason: form.reason,
        channel: "browser"
      });
      return;
    }

    if (params.request.method === "POST" && params.cliApprove && url.pathname === `/cli/plan/${params.planId}/decision`) {
      const form = await readDecisionBody(params.request);
      await params.acceptDecision({
        decision: form.decision === "rejected" ? "rejected" : "approved",
        reason: form.reason,
        channel: "cli"
      });
      return;
    }

    writeText(params.response, 404, "Not found.");
  }
}

function canUseElicitation(context: ApprovalClientContext): context is ApprovalClientContext & { elicitInput: ElicitInput } {
  if (!context.elicitInput || !context.clientCapabilities?.elicitation) {
    return false;
  }

  const names = [context.clientInfo?.name, context.clientInfo?.title].filter((name): name is string => typeof name === "string");
  return names.some((name) => normalizeClientName(name) === "claude-code");
}

function normalizeClientName(name: string): string {
  return name.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

function reasonFromContent(content: Record<string, unknown> | undefined): string {
  return typeof content?.reason === "string" ? content.reason : "";
}

function requestUrl(request: IncomingMessage): URL | null {
  if (!request.url) {
    return null;
  }

  return new URL(request.url, "http://127.0.0.1");
}

async function readDecisionBody(request: IncomingMessage): Promise<{ decision: "approved" | "rejected"; reason: string }> {
  const raw = await readBody(request, 8192);
  const contentType = request.headers["content-type"] ?? "";
  if (contentType.includes("application/json")) {
    try {
      const parsed: unknown = JSON.parse(raw || "{}");
      if (isObject(parsed)) {
        return {
          decision: parsed.decision === "rejected" ? "rejected" : "approved",
          reason: typeof parsed.reason === "string" ? parsed.reason : ""
        };
      }
    } catch {
      return { decision: "rejected", reason: "" };
    }
  }

  const params = new URLSearchParams(raw);
  return {
    decision: params.get("decision") === "rejected" ? "rejected" : "approved",
    reason: params.get("reason") ?? ""
  };
}

async function readBody(request: IncomingMessage, maxBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      break;
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks).toString("utf8");
}

function writeText(response: ServerResponse, status: number, text: string): void {
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(text);
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(0, "127.0.0.1");
  });
}

function serverPort(server: Server): number {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Approval listener did not expose a TCP port.");
  }

  return address.port;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }

    server.close(() => {
      resolve();
    });
  });
}

async function openDefaultBrowser(url: string): Promise<void> {
  const { spawn } = await import("node:child_process");
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore"
    });
    child.on("error", reject);
    child.on("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
