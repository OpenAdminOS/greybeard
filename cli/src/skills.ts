import { getGreybeardAppDataPath } from "@greybeard/graph";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { deflateRawSync } from "node:zlib";
import { flagValue, ParsedArgs } from "./args.js";
import { listSkillSourceDirs, repoSkillsDir, type SkillSourceDir } from "./clients.js";
import { CliRuntime, writeInfoLine, writeLine, writeStatusLine } from "./runtime.js";

export type PackedSkill = {
  name: string;
  path: string;
};

type ZipEntry = {
  name: string;
  data: Buffer;
  directory: boolean;
};

export async function runSkills(args: ParsedArgs, runtime: CliRuntime): Promise<number> {
  if (args.positionals[0] !== "pack") {
    writeLine(runtime.stderr, "Usage: greybeard skills pack [--out <directory>]");
    return 1;
  }

  const appDataPath = flagValue(args, "app-data") || runtime.env.GREYBEARD_APP_DATA || getGreybeardAppDataPath();
  const outputDir = flagValue(args, "out") || join(appDataPath, "skill-zips");
  let packed: PackedSkill[];
  try {
    packed = await packSkills(runtime, outputDir);
  } catch (error) {
    writeLine(runtime.stderr, error instanceof Error ? error.message : String(error));
    return 1;
  }

  writeLine(runtime.stdout, "Greybeard skill ZIPs");
  writeLine(runtime.stdout, "────────────────────");
  for (const skill of packed) {
    writeStatusLine(runtime.stdout, "OK", skill.name, skill.path);
  }
  if (packed.length === 0) {
    writeInfoLine(runtime.stdout, "Skills", "none found");
  }
  writeInfoLine(runtime.stdout, "Upload", "open Claude Desktop Settings > Capabilities > Skills and upload each ZIP");
  writeInfoLine(runtime.stdout, "Updates", "after a skill changes, pack again and re-upload its ZIP");
  return 0;
}

export async function packSkills(runtime: CliRuntime, outputDir: string): Promise<PackedSkill[]> {
  const tree = await listSkillSourceDirs(repoSkillsDir(runtime.repoRoot));
  if (tree.duplicates.length > 0) {
    const details = tree.duplicates
      .map((skill) => `${skill.name} in ${skill.existingCategory} and ${skill.category}`)
      .join(", ");
    throw new Error(`Cannot pack skills with duplicate folder names: ${details}`);
  }

  await mkdir(outputDir, { recursive: true });
  return Promise.all(tree.sources.map(async (skill) => {
    const path = join(outputDir, `${skill.name}.zip`);
    const entries = await skillZipEntries(skill);
    await writeFile(path, createZip(entries), { mode: 0o600 });
    return {
      name: skill.name,
      path
    };
  }));
}

async function skillZipEntries(skill: SkillSourceDir): Promise<ZipEntry[]> {
  const entries: ZipEntry[] = [{
    name: `${skill.name}/`,
    data: Buffer.alloc(0),
    directory: true
  }];
  await collectZipEntries(skill.path, skill.path, skill.name, entries);
  return entries;
}

async function collectZipEntries(
  root: string,
  current: string,
  skillName: string,
  entries: ZipEntry[]
): Promise<void> {
  const children = await readdir(current, { withFileTypes: true });
  children.sort((left, right) => left.name.localeCompare(right.name));
  for (const child of children) {
    const path = join(current, child.name);
    const relativePath = relative(root, path).split("\\").join("/");
    const zipPath = `${skillName}/${relativePath}`;
    if (child.isDirectory()) {
      entries.push({
        name: `${zipPath}/`,
        data: Buffer.alloc(0),
        directory: true
      });
      await collectZipEntries(root, path, skillName, entries);
    } else if (child.isFile()) {
      entries.push({
        name: zipPath,
        data: await readFile(path),
        directory: false
      });
    }
  }
}

function createZip(entries: ZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const compressed = entry.directory ? entry.data : deflateRawSync(entry.data);
    const method = entry.directory ? 0 : 8;
    const checksum = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(0x00210000, 10);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(0x00210000, 12);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(entry.directory ? 0x10 : 0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

const CRC32_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(data: Buffer): number {
  let value = 0xffffffff;
  for (const byte of data) {
    value = (value >>> 8) ^ (CRC32_TABLE[(value ^ byte) & 0xff] as number);
  }
  return (value ^ 0xffffffff) >>> 0;
}
