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

export type SlackUser = {
  id: string;
  /** Workspace handle (`user.name`) — usually `firstname.lastname`. */
  handle: string;
  /** `profile.display_name`, empty when the member never set one. */
  displayName: string;
};

export type SlackChannelInfo = {
  id: string;
  name: string;
  /** `false` means chat.postMessage would fail with channel_not_found. */
  isMember: boolean;
};

export type SlackUserInfo = {
  id: string;
  name: string;
  isAdmin: boolean;
  isOwner: boolean;
};

export interface SlackClient {
  postParent(input: PostParentInput): Promise<PostResult>;
  updateParent(input: UpdateParentInput): Promise<void>;
  postReply(input: PostReplyInput): Promise<void>;
  listUsers(): Promise<SlackUser[]>;
  publishHome(input: { userId: string; view: unknown }): Promise<void>;
  openModal(input: { triggerId: string; view: unknown }): Promise<void>;
  getChannel(channelId: string): Promise<SlackChannelInfo>;
  getUser(userId: string): Promise<SlackUserInfo>;
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
    async listUsers() {
      const out: SlackUser[] = [];
      let cursor: string | undefined;
      do {
        const r = await web.users.list(cursor ? { limit: 200, cursor } : { limit: 200 });
        for (const m of r.members ?? []) {
          if (!m.id || m.deleted || m.is_bot || m.id === "USLACKBOT") continue;
          out.push({
            id: m.id,
            handle: m.name ?? "",
            displayName: m.profile?.display_name ?? "",
          });
        }
        cursor = r.response_metadata?.next_cursor || undefined;
      } while (cursor);
      return out;
    },
    async publishHome({ userId, view }) {
      await web.views.publish({ user_id: userId, view: view as never });
    },
    async openModal({ triggerId, view }) {
      await web.views.open({ trigger_id: triggerId, view: view as never });
    },
    async getChannel(channelId) {
      const r = await web.conversations.info({ channel: channelId });
      return {
        id: channelId,
        name: r.channel?.name ?? channelId,
        isMember: r.channel?.is_member === true,
      };
    },
    async getUser(userId) {
      const r = await web.users.info({ user: userId });
      return {
        id: userId,
        name: r.user?.profile?.display_name || r.user?.real_name || r.user?.name || userId,
        isAdmin: r.user?.is_admin === true,
        isOwner: r.user?.is_owner === true,
      };
    },
  };
}
