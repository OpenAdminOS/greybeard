export function toPortablePath(value: string): string {
  return value.replace(/\\/gu, "/");
}
