export interface KataIssue {
  id: number;
  uid: string;
  project_id: number;
  project_uid: string;
  number: number;
  title: string;
  body: string | null;
  status: "open" | "closed";
  closed_reason: "done" | "wontfix" | "duplicate" | null;
  owner: string | null;
  priority: number | null;
  author: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

export interface KataComment {
  id: number;
  issue_id: number;
  author: string;
  body: string;
  created_at: string;
}

export interface KataLink {
  id: number;
  project_id: number;
  from_number?: number;
  from_issue_uid?: string;
  to_number?: number;
  to_issue_uid?: string;
  from?: { uid: string; short_id: string };
  to?: { uid: string; short_id: string };
  type: "parent" | "blocks" | "related";
  author: string;
  created_at: string;
}

export interface KataLabel {
  issue_id: number;
  label: string;
  author: string;
  created_at: string;
}

export interface KataListIssue extends KataIssue {
  short_id?: string;
  qualified_id?: string;
  labels?: string[];
  parent_short_id?: string | null;
  parent_number?: number | null;
  child_counts?: { open: number; total: number } | null;
  blocks?: Array<{ uid: string; short_id: string }>;
  blocked_by?: Array<{ uid: string; short_id: string }>;
  related?: Array<{ uid: string; short_id: string }>;
}

export interface KataShowResponse {
  kata_api_version: number;
  issue: KataIssue;
  comments: KataComment[] | null;
  links: KataLink[] | null;
  labels: KataLabel[] | null;
  parent: {
    uid?: string;
    short_id?: string;
    qualified_id?: string;
    number?: number;
    title?: string;
    status?: string;
  } | null;
  children: Array<Record<string, unknown>> | null;
}

export interface KataListResponse {
  kata_api_version: number;
  issues: KataListIssue[];
}

export interface KataEvent {
  event_id: number;
  event_uid: string;
  type: string;
  project_id: number;
  issue_id: number;
  issue_number: number;
  actor: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface KataEventsResponse {
  kata_api_version: number;
  reset_required: boolean;
  events: KataEvent[];
  next_after_id: number;
}

export interface KataHealthResponse {
  kata_api_version: number;
  ok: boolean;
  db_path: string;
  schema_version: number;
  version: string;
  uptime: string;
  started_at: string;
}

export interface KataCreateResponse {
  kata_api_version: number;
  issue: KataIssue;
  event: KataEvent;
  changed: boolean;
  reused: boolean;
}

export type IssueGroup = "open" | "closed";

export function classifyIssue(issue: KataListIssue): IssueGroup {
  return issue.status === "open" ? "open" : "closed";
}

export function relativeTime(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffSec = Math.floor((now - then) / 1000);

  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}
