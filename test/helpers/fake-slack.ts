import type {
  PostParentInput,
  PostReplyInput,
  SlackClient,
  SlackUser,
  UpdateParentInput,
  PostResult,
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
  private nextTsN = 1_700_000_000;

  async postParent(input: PostParentInput): Promise<PostResult> {
    const ts = `${this.nextTsN++}.000100`;
    this.calls.push({ kind: "postParent", ...input, ts });
    return { ts };
  }

  async updateParent(input: UpdateParentInput): Promise<void> {
    this.calls.push({ kind: "updateParent", ...input });
  }

  async postReply(input: PostReplyInput): Promise<void> {
    this.calls.push({ kind: "postReply", ...input });
  }

  async listUsers(): Promise<SlackUser[]> {
    if (this.listUsersError) throw this.listUsersError;
    return this.users;
  }

  filter(kind: FakeCall["kind"]): FakeCall[] {
    return this.calls.filter((c) => c.kind === kind);
  }
}
