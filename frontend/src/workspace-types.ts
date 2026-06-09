export type StatusCategory = "active" | "deferred" | "completed" | "archived";

export type Status = {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly category: StatusCategory;
  readonly showInTodoView: boolean;
  readonly isDefaultForNewItems: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type TodoItem = {
  readonly id: string;
  readonly userId: string;
  readonly nodeId: string | null;
  readonly statusId: string;
  readonly statusName: string;
  readonly statusCategory: StatusCategory;
  readonly kind: string;
  readonly title: string | null;
  readonly body: string;
  readonly sourceCaptureId: string | null;
  readonly statusChangedAt: string;
  readonly todoRank: string | null;
  readonly todoRankChangedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type Folder = {
  readonly id: string;
  readonly userId: string;
  readonly parentId: string | null;
  readonly name: string;
  readonly kind: string;
  readonly directItemCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type WorkspaceViewMode = "inbox" | "actions" | "reference";

export type WorkspaceRoots = {
  readonly actions: Folder;
  readonly reference: Folder;
};

export type WorkspaceView = {
  readonly view: WorkspaceViewMode;
  readonly user: {
    readonly email: string;
  };
  readonly roots: WorkspaceRoots;
  readonly folder: Folder | null;
  readonly folders: ReadonlyArray<Folder>;
  readonly ancestors: ReadonlyArray<Folder>;
  readonly inboxCount: number;
  readonly todos: ReadonlyArray<TodoItem>;
  readonly statuses: ReadonlyArray<Status>;
  readonly selectedStatusIds: ReadonlyArray<string>;
};

export type WorkspaceSelection = {
  readonly view: WorkspaceViewMode;
  readonly folderId: string | null;
  readonly statusIds: ReadonlyArray<string>;
};

export type EditDraft = {
  readonly title: string;
  readonly body: string;
  readonly folderId: string;
};

export type DialogState =
  | { readonly type: "create" }
  | { readonly type: "status"; readonly item: TodoItem }
  | {
      readonly type: "bulk-status";
      readonly items: ReadonlyArray<TodoItem>;
      readonly itemIndex: number;
      readonly statusId: string | null;
    }
  | { readonly type: "move"; readonly item: TodoItem }
  | { readonly type: "bulk-move" }
  | null;
