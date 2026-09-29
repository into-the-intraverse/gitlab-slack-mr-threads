import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";

export type SlackApiCall = {
  method: string;
  /** Form fields as the Web API client sent them; `blocks` arrives JSON-encoded. */
  args: Record<string, string>;
  authorization: string | undefined;
};

export type FakeSlackServer = {
  /** Base URL for `SLACK_API_URL`, trailing slash included. */
  url: string;
  calls: SlackApiCall[];
  of: (method: string) => SlackApiCall[];
  close: () => Promise<void>;
};

/**
 * Stands in for slack.com over real HTTP, so the end-to-end run exercises the
 * actual `@slack/web-api` client — its wire format, its auth header, its
 * retries — instead of a hand-written fake of it.
 */
export async function startFakeSlack(): Promise<FakeSlackServer> {
  const calls: SlackApiCall[] = [];
  let ts = 1_700_000_000;

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const method = (req.url ?? "").replace(/^\/api\//, "").split("?")[0] ?? "";
      const args = Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString("utf8")));
      calls.push({ method, args, authorization: req.headers.authorization });

      const body =
        method === "users.list"
          ? { ok: true, members: [] }
          : method === "chat.postMessage"
            ? { ok: true, ts: `${ts++}.000100`, channel: args.channel }
            : { ok: true };

      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/api/`,
    calls,
    of: (method) => calls.filter((c) => c.method === method),
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}
