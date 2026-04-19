import { createHash } from "node:crypto";

export function hashParent(text: string, blocks: unknown[]): string {
  return createHash("sha256")
    .update(text)
    .update("\x00")
    .update(JSON.stringify(blocks))
    .digest("hex");
}
