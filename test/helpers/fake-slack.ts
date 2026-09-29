import type {
  PostParentInput,
  PostReplyInput,
  PostResult,
  SlackChannelInfo,
  SlackClient,
  SlackUser,
  SlackUserInfo,
  UpdateParentInput,
} from "../../src/slack/client.js";

export type FakeCall =
  | ({ kind: "postParent" } & PostParentInput & { ts: string })
  | ({ kind: "updateParent" } & UpdateParentInput)
  | ({ kind: "postReply" } & PostReplyInput);

export class FakeSlackClient implements SlackClient {
  public calls: FakeCall[] = [];
  public users: SlackUser[] = [];
  /** Set to make listUsers() reject, mimicking a missing `users:read` scope. */
  public listUsersError: Error | null = null;
  /** Set to make every post/update reject, mimicking a Slack outage. */
  public postError: Error | null = null;
  /** Set to make publishHome() reject, e.g. an expired App Home view. */
  public publishHomeError: Error | null = null;
  /** Last view published per user — the panel only ever cares about the latest. */
  public publishedHome = new Map<string, unknown>();
  public openedModals: Array<{ triggerId: string; view: unknown }> = [];
  public channels = new Map<string, SlackChannelInfo>();
  public usersById = new Map<string, SlackUserInfo>();
  public getChannelError: Error | null = null;
  public getUserError: Error | null = null;
  private nextTsN = 1_700_000_000;

  async postParent(input: PostParentInput): Promise<PostResult> {
    if (this.postError) throw this.postError;
    const ts = `${this.nextTsN++}.000100`;
    this.calls.push({ kind: "postParent", ...input, ts });
    return { ts };
  }

  async updateParent(input: UpdateParentInput): Promise<void> {
    if (this.postError) throw this.postError;
    this.calls.push({ kind: "updateParent", ...input });
  }

  async postReply(input: PostReplyInput): Promise<void> {
    if (this.postError) throw this.postError;
    this.calls.push({ kind: "postReply", ...input });
  }

  async listUsers(): Promise<SlackUser[]> {
    if (this.listUsersError) throw this.listUsersError;
    return this.users;
  }

  async publishHome({ userId, view }: { userId: string; view: unknown }): Promise<void> {
    if (this.publishHomeError) throw this.publishHomeError;
    this.publishedHome.set(userId, view);
  }

  async openModal(input: { triggerId: string; view: unknown }): Promise<void> {
    this.openedModals.push(input);
  }

  async getChannel(channelId: string): Promise<SlackChannelInfo> {
    if (this.getChannelError) throw this.getChannelError;
    // An unseeded channel is one the bot has never been added to.
    return this.channels.get(channelId) ?? { id: channelId, name: channelId, isMember: false };
  }

  async getUser(userId: string): Promise<SlackUserInfo> {
    if (this.getUserError) throw this.getUserError;
    return (
      this.usersById.get(userId) ?? { id: userId, name: userId, isAdmin: false, isOwner: false }
    );
  }

  filter(kind: FakeCall["kind"]): FakeCall[] {
    return this.calls.filter((c) => c.kind === kind);
  }
}
