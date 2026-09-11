import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";
import { createRuntime } from "./runtime.js";
import { startSetupUi } from "./setupUi.js";

// Execute the shipped inline script against a minimal DOM. innerHTML is deliberately
// unavailable so untrusted memory text must travel through textContent.
class Element {
  children: Element[] = [];
  textContent = "";
  hidden = false;
  disabled = false;
  onclick?: () => Promise<void>;
  append(...elements: Element[]) { this.children.push(...elements); }
  replaceChildren() { this.children = []; }
  get childElementCount() { return this.children.length; }
  set innerHTML(_: string) { throw new Error("Do not interpret memory as HTML"); }
}

async function ui() {
  const appData = await mkdtemp(join(tmpdir(), "greybeard-ui-test-"));
  const { server, url } = await startSetupUi(createRuntime(), appData);
  let html: string;
  try { html = await (await fetch(new URL(url).origin)).text(); }
  finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(appData, { recursive: true, force: true });
  }
  const elements = new Map<string, Element>();
  const get = (id: string) => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id)!;
  };
  const pages: Array<{ results: object[]; nextCursor?: number }> = [];
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  const confirm = vi.fn(() => true);
  const context = {
    location: { hash: "#test-session" }, history: { replaceState() {} },
    document: { getElementById: get, createElement: () => new Element(), createTextNode: () => new Element() },
    confirm, prompt: vi.fn(() => "Changed rollout rule"),
    fetch: async (path: string, options: { body: string }) => {
      calls.push({ path, body: JSON.parse(options.body) });
      const data = path === "/state" ? { clients: [], capabilities: [], learningEnabled: true } : path === "/memories" ? pages.shift() : {};
      return { ok: true, json: async () => data };
    }
  };
  const script = html!.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)![1];
  runInNewContext(script, context);
  await Promise.resolve();
  return { get, pages, calls, confirm };
}

function node(id: number, type: string, status = "confirmed") {
  return { id, type, status, scope: "global", content: `Memory ${id}`, revision: `revision-${id}`, supersededAt: null };
}

it("keeps preferences separate across pages and preserves exact safe confirmation", async () => {
  const f = await ui();
  const preference = { ...node(3, "preference", "candidate"), content: "<img src=x onerror=alert(1)> Use a pilot first." };
  f.pages.push({ results: [preference], nextCursor: 3 });
  await f.get("refresh").onclick!();
  expect(f.get("preferences").childElementCount).toBe(1);
  expect(f.get("lessons").childElementCount).toBe(0);
  expect(f.get("lessons-empty").textContent).toContain("loaded memories");
  expect(f.get("more").hidden).toBe(false);
  const article = f.get("preferences").children[0];
  expect(article.children[1].textContent).toBe(preference.content);
  const confirmButton = article.children[2].children[0];
  expect(confirmButton.textContent).toBe("Confirm this preference");
  f.pages.push({ results: [node(2, "fact"), node(1, "preference")] });
  await f.get("more").onclick!();
  expect(f.calls.at(-1)).toEqual({ path: "/memories", body: { cursor: 3 } });
  expect(f.get("preferences").childElementCount).toBe(2);
  expect(f.get("lessons").childElementCount).toBe(1);
  expect(f.get("more").hidden).toBe(true);
  f.pages.push({ results: [{ ...preference, status: "confirmed" }, node(2, "fact")] });
  await confirmButton.onclick!();
  expect(f.confirm).toHaveBeenCalledWith(`Confirm this exact preference?\n\n${preference.content}`);
  expect(f.calls).toContainEqual({ path: "/confirm", body: { id: 3, content: preference.content, revision: preference.revision } });
  expect(f.get("status").textContent).toBe("Preference confirmed.");
});

it("keeps corrections pending, removes forgotten cards and retains shared controls", async () => {
  const f = await ui();
  f.pages.push({ results: [node(4, "preference"), { ...node(2, "fact"), supersededAt: 1 }] });
  await f.get("refresh").onclick!();
  const actions = f.get("preferences").children[0].children[2].children;
  expect(actions.map(x => x.textContent)).toEqual(["Forget", "Correct"]);
  expect(f.get("lessons").children[0].children[2].children.map(x => x.textContent)).toEqual(["Forget"]);
  f.pages.push({ results: [node(4, "preference"), node(5, "preference", "candidate")] });
  await actions[1].onclick!();
  expect(f.calls).toContainEqual({ path: "/correct", body: { id: 4, content: "Changed rollout rule" } });
  expect(f.get("status").textContent).toContain("previous memory remains active");
  expect(f.calls.some(call => call.path === "/confirm")).toBe(false);
  f.pages.push({ results: [] });
  await actions[0].onclick!();
  expect(f.get("preferences").childElementCount).toBe(0);
  expect(f.get("preferences-empty").hidden).toBe(false);
  await f.get("pause").onclick!();
  expect(f.calls).toContainEqual({ path: "/pause", body: { paused: true } });
  expect(f.get("pause").textContent).toBe("Resume learning and advice");
});
