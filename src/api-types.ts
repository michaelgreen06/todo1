import type { Folder, Item, Status, User } from "./db.js";

export type WorkspaceView = {
  readonly user: Pick<User, "email">;
  readonly folder: Folder | null;
  readonly folders: ReadonlyArray<Folder>;
  readonly ancestors: ReadonlyArray<Folder>;
  readonly inboxCount: number;
  readonly todos: ReadonlyArray<Item>;
  readonly statuses: ReadonlyArray<Status>;
  readonly selectedStatusIds: ReadonlyArray<string>;
};

export type WorkspaceViewRequest = {
  readonly folderId: string | null;
  readonly statusIds: ReadonlyArray<string> | null;
};

export type ApiWorkspaceResponse = {
  readonly workspace: WorkspaceView;
};

export type ApiTodoResponse = {
  readonly item: Item;
};
