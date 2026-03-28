export function formatSampleBytes(bytes?: number): string {
  if (bytes === undefined || bytes === null) return "0 KB";
  const mb = bytes / 1048576;
  if (mb >= 1) return `${mb.toFixed(2)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function shortValue(value: string, length: number): string {
  return value.length > length ? `${value.slice(0, length)}...` : value;
}
