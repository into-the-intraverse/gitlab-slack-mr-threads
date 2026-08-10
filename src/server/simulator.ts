import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";

// src/server/ in dev, dist/server/ after build — both sit two levels below the repo root.
const here = dirname(fileURLToPath(import.meta.url));
const pagePath = resolve(here, "../../public/simulator.html");

/**
 * Dev-only page that fakes GitLab `Merge Request Hook` deliveries.
 *
 * It is served from the app itself so the browser posts same-origin: the
 * X-Gitlab-* headers would otherwise trigger a CORS preflight that this server
 * does not answer.
 */
export function registerSimulatorRoute(app: FastifyInstance): void {
  app.get("/dev/simulator", async (_req, reply) => {
    let html: string;
    try {
      // Read per request so edits to the page show up without a restart.
      html = readFileSync(pagePath, "utf8");
    } catch {
      reply.code(500).send({ error: `simulator page not found at ${pagePath}` });
      return;
    }
    reply.type("text/html; charset=utf-8").header("cache-control", "no-store").send(html);
  });
}
