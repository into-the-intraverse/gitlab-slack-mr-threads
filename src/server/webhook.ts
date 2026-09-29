import type { FastifyInstance } from "fastify";
import { insertInboxRow } from "../persistence/inbox.js";
import type { KyselyDb } from "../db/index.js";
import type { Logger } from "../logger.js";
import { verifyGitlabToken } from "../gitlab/verify.js";

export type WebhookDeps = {
  db: KyselyDb;
  log: Logger;
  gitlabWebhookSecret: string;
};

export function registerWebhookRoute(app: FastifyInstance, deps: WebhookDeps): void {
  app.post("/webhooks/gitlab", async (req, reply) => {
    // Node joins duplicate headers into one comma-separated string; only
    // set-cookie is ever handed over as an array. These three never are.
    const token = req.headers["x-gitlab-token"] as string | undefined;
    if (!verifyGitlabToken(token, deps.gitlabWebhookSecret)) {
      deps.log.warn({ ip: req.ip }, "webhook: bad token");
      reply.code(401).send({ error: "unauthorized" });
      return;
    }

    const webhookUuid = req.headers["x-gitlab-webhook-uuid"] as string | undefined;
    const eventUuid = req.headers["x-gitlab-event-uuid"] as string | undefined;

    if (!webhookUuid) {
      reply.code(400).send({ error: "missing X-Gitlab-Webhook-UUID" });
      return;
    }

    let payloadStr: string;
    if (typeof req.body === "string") {
      payloadStr = req.body;
    } else if (req.body && typeof req.body === "object") {
      payloadStr = JSON.stringify(req.body);
    } else {
      reply.code(400).send({ error: "invalid body" });
      return;
    }

    try {
      const inserted = await insertInboxRow(deps.db, {
        webhook_uuid: webhookUuid,
        event_uuid: eventUuid ?? null,
        payload_json: payloadStr,
      });
      deps.log.info(
        { corr_id: webhookUuid, inserted },
        inserted ? "webhook: enqueued" : "webhook: duplicate ignored",
      );
      reply.code(200).send({ ok: true, duplicate: !inserted });
    } catch (err) {
      deps.log.error({ err, corr_id: webhookUuid }, "webhook: persist failed");
      reply.code(500).send({ error: "persist failed" });
    }
  });
}
