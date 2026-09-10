import { access, open } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  FetchLike,
  MsalGraphAuthProvider,
  type ClientIdKind,
  type CredentialMode
} from "@greybeard/graph";

export type OutputStream = Pick<NodeJS.WriteStream, "write">;

export type AuthFactoryOptions = {
  tenantId?: string;
  clientId?: string;
  clientIdKind?: ClientIdKind;
  credentialMode?: CredentialMode;
  writesConfigured?: boolean;
  appDataPath?: string;
  fetcher?: FetchLike;
};

export type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export type ConfirmationResult = "confirmed" | "cancelled" | "non-interactive";

export type CliRuntime = {
  env: NodeJS.ProcessEnv;
  cwd: string;
  homeDir: string;
  platform: NodeJS.Platform;
  nodePath: string;
  packaged?: boolean;
  repoRoot: string;
  stdin: NodeJS.ReadStream;
  stdout: OutputStream;
  stderr: OutputStream;
  fetcher: FetchLike;
  authFactory: (options: AuthFactoryOptions) => Promise<{
    getToken(scopes: string[]): Promise<import("@greybeard/graph").AuthToken>;
    getStatus(): Promise<import("@greybeard/graph").AuthStatus>;
    addScopes(input: { scopes: string[]; reason: string }): Promise<import("@greybeard/graph").AddScopeResult>;
  }>;
  findExecutable: (command: string) => Promise<string | null>;
  confirm: (prompt: string) => Promise<ConfirmationResult>;
  runCommand: (command: string, args: string[], options?: {
    cwd?: string;
    input?: string;
  }) => Promise<CommandResult>;
};

export function createRuntime(): CliRuntime {
  const env = process.env;
  const platform = process.platform;
  return {
    env,
    cwd: process.cwd(),
    homeDir: env.GREYBEARD_HOME || homedir(),
    platform,
    nodePath: process.execPath,
    packaged: process.env.GREYBEARD_PACKAGED === "1",
    repoRoot: env.GREYBEARD_REPO_DIR || defaultRepoRoot(),
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    fetcher: globalThis.fetch as unknown as FetchLike,
    authFactory: (options) => MsalGraphAuthProvider.create(options),
    findExecutable: (command) => findExecutable(command, env, platform),
    confirm: (prompt) => confirmWithTerminal(prompt, process.stdin, process.stdout, platform),
    runCommand
  };
}

export function defaultRepoRoot(): string {
  return process.env.GREYBEARD_ASSET_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), "../..");
}

export function writeLine(stream: OutputStream, line = ""): void {
  stream.write(`${line}\n`);
}

export function writeSection(stream: OutputStream, title: string): void {
  writeLine(stream, "");
  writeLine(stream, title);
  writeLine(stream, "─".repeat(title.length));
}

export type OutputStyle = {
  color: boolean;
  unicode: boolean;
};

type MaybeTtyStream = OutputStream & { isTTY?: boolean };

const ANSI_RESET = "\u001b[0m";

const MARKER_STYLES: Record<string, { symbol: string; ansiColor: string }> = {
  OK: { symbol: "✓", ansiColor: "\u001b[32m" },
  PASS: { symbol: "✓", ansiColor: "\u001b[32m" },
  WARN: { symbol: "!", ansiColor: "\u001b[33m" },
  FAIL: { symbol: "✗", ansiColor: "\u001b[31m" }
};

export function outputStyle(
  stream: OutputStream,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): OutputStyle {
  const tty = Boolean((stream as MaybeTtyStream).isTTY);
  const color = env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== "0"
    ? true
    : tty && env.NO_COLOR === undefined && env.TERM !== "dumb";
  return {
    color,
    unicode: tty && supportsUnicodeSymbols(env, platform)
  };
}

function supportsUnicodeSymbols(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): boolean {
  if (platform === "win32") {
    // Legacy conhost code pages garble U+2713; modern Windows terminals identify themselves.
    return Boolean(
      env.WT_SESSION
      || env.TERM_PROGRAM
      || env.ConEmuANSI === "ON"
      || env.TERMINAL_EMULATOR === "JetBrains-JediTerm"
      || (env.TERM && env.TERM !== "dumb")
    );
  }

  // The bare Linux console font lacks the check-mark glyphs; terminal emulators render them.
  return env.TERM !== "linux";
}

export function writeStatusLine(
  stream: OutputStream,
  marker: string,
  label: string,
  detail: string,
  labelWidth = 24
): void {
  const style = outputStyle(stream);
  const known = MARKER_STYLES[marker];
  const text = (style.unicode && known ? known.symbol : marker).padEnd(5);
  const painted = style.color && known ? `${known.ansiColor}${text}${ANSI_RESET}` : text;
  writeLine(stream, `${painted} ${label.padEnd(labelWidth)} ${detail}`);
}

export function writeInfoLine(
  stream: OutputStream,
  label: string,
  detail: string,
  labelWidth = 24
): void {
  writeLine(stream, `${"".padEnd(6)}${label.padEnd(labelWidth)} ${detail}`);
}

export function writeNoteLine(stream: OutputStream, detail: string): void {
  writeLine(stream, `${"".padEnd(6)}note: ${detail}`);
}

export async function findExecutable(
  command: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform
): Promise<string | null> {
  const override = env[`GREYBEARD_${command.toUpperCase()}_BINARY`];
  if (override) {
    return override;
  }

  const pathValue = env.PATH || "";
  const directories = pathValue.split(platform === "win32" ? ";" : ":").filter(Boolean);
  const extensions = platform === "win32"
    ? (env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";")
    : [""];

  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = resolve(directory, platform === "win32" && !command.toLowerCase().endsWith(extension.toLowerCase())
        ? `${command}${extension.toLowerCase()}`
        : command);
      if (await canExecute(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

export async function confirmWithTerminal(
  prompt: string,
  stdin: NodeJS.ReadStream,
  stdout: OutputStream,
  platform: NodeJS.Platform
): Promise<ConfirmationResult> {
  const ttyInput = await openDevTty(platform);
  if (ttyInput) {
    return readConfirmationLine(ttyInput, prompt, stdout);
  }

  if (stdin.isTTY) {
    return readConfirmationLine(stdin, prompt, stdout);
  }

  return "non-interactive";
}

async function canExecute(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function openDevTty(platform: NodeJS.Platform): Promise<NodeJS.ReadableStream | null> {
  if (platform === "win32") {
    return null;
  }

  try {
    const handle = await open("/dev/tty", "r");
    return handle.createReadStream({
      autoClose: true
    });
  } catch {
    return null;
  }
}

function readConfirmationLine(
  input: NodeJS.ReadableStream,
  prompt: string,
  stdout: OutputStream
): Promise<ConfirmationResult> {
  stdout.write(prompt);
  return new Promise((resolvePromise) => {
    const rl = createInterface({
      input,
      terminal: true
    });
    let resolved = false;
    const finish = (result: ConfirmationResult) => {
      if (resolved) {
        return;
      }

      resolved = true;
      rl.close();
      resolvePromise(result);
    };

    rl.once("line", () => finish("confirmed"));
    rl.once("SIGINT", () => finish("cancelled"));
    rl.once("close", () => finish("cancelled"));
  });
}

export function runCommand(command: string, args: string[], options: {
  cwd?: string;
  input?: string;
} = {}): Promise<CommandResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"]
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      resolvePromise({
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8")
      });
    });

    if (options.input !== undefined) {
      child.stdin.end(options.input);
    } else {
      child.stdin.end();
    }
  });
}

/** Command used by client integrations; packaged users never need a Node installation. */
export function runtimeCommand(runtime: CliRuntime, args: string[]): { command: string; args: string[] } {
  return runtime.packaged
    ? { command: runtime.nodePath, args }
    : { command: runtime.nodePath, args: [resolve(runtime.repoRoot, "cli/dist/index.js"), ...args] };
}
