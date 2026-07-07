import { RenderPlanInput } from "./writeGateTypes.js";

export type RenderedPlan = {
  text: string;
  htmlBody: string;
  pendingFile: Record<string, unknown>;
};

export function renderPlan(input: RenderPlanInput): RenderedPlan {
  const destructiveCount = input.operations.filter((operation) => operation.method === "DELETE").length;
  const patchCount = input.operations.filter((operation) => operation.method === "PATCH").length;
  const lines = [
    `Plan ${input.planId}`,
    `Tenant: ${input.authToken.tenantDomain} (${input.authToken.tenantId})`,
    `Account: ${input.authToken.account}`,
    `Credential: workspace app ${input.authToken.clientId}`,
    `Client: ${input.clientName}`,
    `Session started: ${input.sessionStartedAt}`,
    `Approval deadline: ${input.approvalDeadline}`,
    `Operation count: ${input.operations.length}`,
    `Destructive count: ${destructiveCount}`,
    `Patch count: ${patchCount}`,
    "",
    "Operations:"
  ];

  for (const [index, operation] of input.operations.entries()) {
    lines.push(`${index + 1}. ${operation.method} ${operation.apiVersion} ${operation.path}`);
    lines.push(`   Reason - stated intent (model-provided): ${operation.reason}`);
    if (operation.method === "PATCH" && operation.prefetch) {
      lines.push(`   Diff status: ${operation.prefetch.verified ? "verified" : "unverified"}`);
      for (const field of operation.prefetch.fields) {
        const current = operation.prefetch.verified ? ` current=${formatValue(field.current)}` : "";
        lines.push(`   Field ${field.field}:${current} next=${formatValue(field.next)}`);
      }
      if (operation.prefetch.error) {
        lines.push(`   Prefetch note: ${operation.prefetch.error}`);
      }
    } else if (operation.body !== undefined) {
      lines.push(`   Body: ${formatValue(operation.body)}`);
    }
  }

  lines.push("");
  lines.push(`Summary - stated intent (model-provided): ${input.summary}`);
  lines.push(`Rollback - stated intent (model-provided): ${input.rollback}`);
  lines.push(`Stop on error: ${input.stopOnError ? "true" : "false"}`);

  const htmlBody = [
    "<!doctype html>",
    "<html>",
    "<head>",
    "<meta charset=\"utf-8\">",
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
    `<title>Greybeard approval ${escapeHtml(input.planId)}</title>`,
    "<style>",
    "body{font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:24px;line-height:1.45;color:#16202a;background:#f6f7f8}",
    "main{max-width:960px;margin:0 auto;background:#fff;border:1px solid #d7dde2;border-radius:8px;padding:24px}",
    "h1,h2{margin:0 0 12px}",
    "dl{display:grid;grid-template-columns:180px 1fr;gap:6px 16px}",
    "dt{font-weight:700}",
    "section{border-top:1px solid #e4e8eb;padding-top:18px;margin-top:18px}",
    "article{border:1px solid #d7dde2;border-radius:8px;padding:14px;margin:12px 0}",
    ".verb{font-weight:800;letter-spacing:.04em}",
    ".delete{color:#a4161a}",
    "pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f1f3f5;padding:12px;border-radius:6px}",
    "button{border:0;border-radius:6px;padding:10px 14px;font-weight:700;margin-right:8px;cursor:pointer}",
    "button[name=decision][value=approved]{background:#126b46;color:#fff}",
    "button[name=decision][value=rejected]{background:#a4161a;color:#fff}",
    "textarea{display:block;width:100%;min-height:76px;margin:8px 0 12px}",
    "</style>",
    "</head>",
    "<body>",
    "<main>",
    `<h1>Approve ${escapeHtml(input.planId)}</h1>`,
    "<dl>",
    `<dt>Tenant</dt><dd>${escapeHtml(input.authToken.tenantDomain)} (${escapeHtml(input.authToken.tenantId)})</dd>`,
    `<dt>Account</dt><dd>${escapeHtml(input.authToken.account)}</dd>`,
    `<dt>Credential</dt><dd>workspace app ${escapeHtml(input.authToken.clientId)}</dd>`,
    `<dt>Client</dt><dd>${escapeHtml(input.clientName)}</dd>`,
    `<dt>Session started</dt><dd>${escapeHtml(input.sessionStartedAt)}</dd>`,
    `<dt>Deadline</dt><dd>${escapeHtml(input.approvalDeadline)}</dd>`,
    `<dt>Counts</dt><dd>${input.operations.length} operations, ${destructiveCount} deletes, ${patchCount} patches</dd>`,
    "</dl>",
    "<section>",
    "<h2>Operations</h2>",
    ...input.operations.map((operation, index) => renderOperationHtml(operation, index)),
    "</section>",
    "<section>",
    "<h2>Stated intent (model-provided)</h2>",
    `<p><strong>Summary:</strong> ${escapeHtml(input.summary)}</p>`,
    `<p><strong>Rollback:</strong> ${escapeHtml(input.rollback)}</p>`,
    `<p><strong>Stop on error:</strong> ${input.stopOnError ? "true" : "false"}</p>`,
    "</section>",
    "<section>",
    "<h2>Decision</h2>",
    "<form method=\"post\">",
    "<label for=\"reason\">Reason for rejection or approval note</label>",
    "<textarea id=\"reason\" name=\"reason\"></textarea>",
    "<button name=\"decision\" value=\"approved\">Approve</button>",
    "<button name=\"decision\" value=\"rejected\">Reject</button>",
    "</form>",
    "</section>",
    "</main>",
    "</body>",
    "</html>"
  ].join("");

  return {
    text: lines.join("\n"),
    htmlBody,
    pendingFile: {
      planId: input.planId,
      approvalDeadline: input.approvalDeadline,
      tenant: {
        id: input.authToken.tenantId,
        domain: input.authToken.tenantDomain
      },
      account: input.authToken.account,
      credential: {
        clientId: input.authToken.clientId,
        clientIdKind: input.authToken.clientIdKind,
        credentialMode: input.authToken.credentialMode
      },
      clientName: input.clientName,
      summary: input.summary,
      rollback: input.rollback,
      stopOnError: input.stopOnError,
      operations: input.operations.map((operation, index) => ({
        index,
        method: operation.method,
        apiVersion: operation.apiVersion,
        path: operation.path,
        reason: operation.reason,
        body: operation.body,
        prefetch: operation.prefetch
      }))
    }
  };
}

function renderOperationHtml(operation: RenderPlanInput["operations"][number], index: number): string {
  const body = operation.method === "PATCH" && operation.prefetch
    ? renderPatchDiff(operation.prefetch)
    : `<pre>${escapeHtml(formatValue(operation.body))}</pre>`;
  const deleteClass = operation.method === "DELETE" ? " delete" : "";
  return [
    "<article>",
    `<h3><span class="verb${deleteClass}">${escapeHtml(operation.method)}</span> ${escapeHtml(operation.apiVersion)} ${escapeHtml(operation.path)}</h3>`,
    `<p><strong>Reason - stated intent (model-provided):</strong> ${escapeHtml(operation.reason)}</p>`,
    body,
    "</article>"
  ].join("");
}

function renderPatchDiff(prefetch: NonNullable<RenderPlanInput["operations"][number]["prefetch"]>): string {
  const rows = prefetch.fields.map((field) => {
    const current = prefetch.verified ? `<td><pre>${escapeHtml(formatValue(field.current))}</pre></td>` : "<td>unverified</td>";
    return `<tr><td>${escapeHtml(field.field)}</td>${current}<td><pre>${escapeHtml(formatValue(field.next))}</pre></td></tr>`;
  }).join("");
  const note = prefetch.error ? `<p>${escapeHtml(prefetch.error)}</p>` : "";
  return [
    `<p>Patch diff: ${prefetch.verified ? "verified" : "unverified"}</p>`,
    note,
    "<table>",
    "<thead><tr><th>Field</th><th>Current</th><th>New</th></tr></thead>",
    `<tbody>${rows}</tbody>`,
    "</table>"
  ].join("");
}

function formatValue(value: unknown): string {
  if (value === undefined) {
    return "undefined";
  }

  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value, null, 2);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
