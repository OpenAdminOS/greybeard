export type ParsedArgs = {
  command: string;
  flags: Map<string, string[]>;
  positionals: string[];
};

export function parseArgs(argv: string[]): ParsedArgs {
  const [command = "help", ...rest] = argv;
  const flags = new Map<string, string[]>();
  const positionals: string[] = [];

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index] as string;
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }

    const trimmed = arg.slice(2);
    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex >= 0) {
      addFlag(flags, trimmed.slice(0, equalsIndex), trimmed.slice(equalsIndex + 1));
      continue;
    }

    const next = rest[index + 1];
    if (next && !next.startsWith("--") && flagTakesValue(trimmed)) {
      addFlag(flags, trimmed, next);
      index += 1;
    } else {
      addFlag(flags, trimmed, "true");
    }
  }

  return {
    command,
    flags,
    positionals
  };
}

export function hasFlag(args: ParsedArgs, name: string): boolean {
  return args.flags.has(name);
}

export function flagValue(args: ParsedArgs, name: string): string | undefined {
  return args.flags.get(name)?.at(-1);
}

export function flagValues(args: ParsedArgs, name: string): string[] {
  return args.flags.get(name) ?? [];
}

function addFlag(flags: Map<string, string[]>, name: string, value: string): void {
  const existing = flags.get(name) ?? [];
  existing.push(value);
  flags.set(name, existing);
}

function flagTakesValue(name: string): boolean {
  return ![
    "help",
    "memory-hook",
    "writes",
    "yes",
    "force",
    "with-copilot"
  ].includes(name);
}
