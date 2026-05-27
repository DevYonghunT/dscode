export type ToolCallView = {
  id: string;
  name: string;
  input: Record<string, unknown> | null;
  output?: string;
  isError?: boolean;
  startedAt: number;
};

/**
 * A file the user attached to a chat message.
 *
 * - `image`: stored on disk + sent inline as base64 in the user message
 *   (Claude sees it directly via multimodal input).
 * - `text` : stored on disk; the agent reads it via the Read tool. The chat
 *   message gets a system-style hint listing the workspace-relative path.
 */
export type Attachment = {
  kind: "image" | "text";
  /** Workspace-relative path, e.g. ".dscode-uploads/<sha256>.<ext>". */
  path: string;
  /** Original filename the user uploaded (for display + hint). */
  name: string;
  mime: string;
  size: number;
};

export type ChatTurn = {
  id: string;
  role: "user" | "assistant";
  text: string;
  toolCalls: ToolCallView[];
  /** Only set on user turns when files were attached. */
  attachments?: Attachment[];
  isStreaming?: boolean;
  error?: string;
};

export type TreeNode = {
  name: string;
  path: string;
  type: "dir" | "file";
  children?: TreeNode[];
};

export type Project = {
  id: string; // "default" or short slug
  name: string;
  root: string;
  createdAt: number;
  /** True when this project links to an external folder on the host disk. */
  external?: boolean;
};
