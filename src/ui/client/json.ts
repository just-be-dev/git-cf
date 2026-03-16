import type { JsonValue } from "@/web";

export async function safeReadJson(response: Response): Promise<JsonValue | null> {
  try {
    return (await response.json()) as JsonValue;
  } catch {
    return null;
  }
}
