import { WebClient } from "@slack/web-api";

export type PostParentInput = {
  channel: string;
  text: string;
  blocks: unknown[];
};

export type PostReplyInput = {
  channel: string;
  threadTs: string;
  text: string;
};

export type UpdateParentInput = {
  channel: string;
  ts: string;
  text: string;
  blocks: unknown[];
};

export type PostResult = {
  ts: string;
};

export interface SlackClient {
  postParent(input: PostParentInput): Promise<PostResult>;
  updateParent(input: UpdateParentInput): Promise<void>;
  postReply(input: PostReplyInput): Promise<void>;
}

export function makeRealSlackClient(token: string): SlackClient {
  const web = new WebClient(token);
  return {
    async postParent({ channel, text, blocks }) {
      const r = await web.chat.postMessage({ channel, text, blocks: blocks as never });
      if (!r.ts) throw new Error("chat.postMessage returned no ts");
      return { ts: r.ts };
    },
    async updateParent({ channel, ts, text, blocks }) {
      await web.chat.update({ channel, ts, text, blocks: blocks as never });
    },
    async postReply({ channel, threadTs, text }) {
      await web.chat.postMessage({ channel, thread_ts: threadTs, text });
    },
  };
}
