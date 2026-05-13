# vscode-kata Design Spec

A VS Code extension for [kata](https://github.com/sarcasticbird/kata), a local-first issue tracking CLI. Mirrors the architecture and UX patterns of [vscode-roborev](https://github.com/sarcasticbird/vscode-roborev), adapted for kata's data model (issues, comments, labels, relationships).

## Architecture

Six TypeScript source files with the same separation of concerns as vscode-roborev:

| File | Purpose |
|------|---------|
| `extension.ts` | Entry point, command registration, auto-refresh, project discovery |
| `kata-client.ts` | CLI wrapper — spawns `kata` binary with `--json`, parses JSON responses |
| `issue-tree.ts` | `TreeDataProvider` — groups issues into Open/Closed, renders tree items |
| `issue-webview.ts` | Webview panel — renders issue detail with comments, labels, links, actions |
| `types.ts` | TypeScript interfaces matching kata's JSON API output |

No git content provider — kata doesn't deal with file diffs.

### Build System

- **Bundler:** esbuild (single-file CommonJS bundle)
- **Language:** TypeScript (strict mode)
- **Target:** Node 18+, ES2022
- **External:** `vscode` module not bundled
- **Dev environment:** Flox with nodejs_22

## Extension Manifest (package.json)

### Activation

- Event: `onStartupFinished` — always activates, discovers projects at startup

### UI Contributions

**Activity Bar Container:**
- ID: `kata`
- Title: "kata"
- Icon: `media/kata-icon.svg`

**Sidebar Tree View:**
- View ID: `kataIssues`
- Name: "Issues"
- Parent container: `kata`

**Welcome View:**
- Condition: when `kataIssues` is empty
- Content: "No kata projects found. Run `kata init` in your project to start tracking issues."

### Commands

| Command ID | Title | Icon | Context |
|------------|-------|------|---------|
| `kata.refresh` | Refresh Issues | `$(refresh)` | View title bar |
| `kata.showIssue` | Show Issue | — | Tree item click |
| `kata.close` | Close Issue | — | Context menu (open items) |
| `kata.reopen` | Reopen Issue | — | Context menu (closed items) |
| `kata.createIssue` | Create Issue | `$(plus)` | View title bar |
| `kata.openTui` | Open TUI | `$(terminal)` | View title bar, context menu |

### Context Menu Visibility

- `kata.close`: visible when `viewItem == issueOpen`
- `kata.reopen`: visible when `viewItem == issueClosed`
- `kata.openTui`: visible on all items

## Project Discovery

Mirrors roborev's repo discovery pattern:

1. Scan each workspace folder for `.kata.toml` at root
2. Scan one level deep (immediate subdirectories) for `.kata.toml`
3. Parse each `.kata.toml` to extract `[project] name` for the tree root label
4. Deduplicate by absolute path
5. Re-scan on workspace folder changes

Each discovered project becomes a root node in the tree view.

## Tree View

### Structure

```
kata
├── uncutgemini
│   ├── Open (3)
│   │   ├── #26 — Add login flow          cdolan · 2h ago
│   │   ├── #25 — Fix navbar bug           · 1d ago
│   │   └── #24 — Update deps              cdolan · 3d ago
│   └── Closed
│       └── #23 — Refactor auth            done · 5d ago
└── vscode-kata
    └── Open (0)
```

### Tree Item Rendering

**Root nodes (projects):**
- Label: project name from `.kata.toml`
- Description: open issue count
- Icon: `$(project)`
- Collapsible: expanded by default

**Group nodes (Open/Closed):**
- Label: "Open" or "Closed" with count in parentheses
- Collapsible: Open expanded, Closed collapsed by default

**Issue items:**
- Label: `#<number> — <title>` (title truncated to 50 chars)
- Description: `<owner> · <relative-time>` (owner omitted if unassigned)
- Context value: `issueOpen` or `issueClosed`
- Icons:
  - Open: `$(circle-filled)` with blue color
  - Closed (done): `$(check)` with green color
  - Closed (wontfix/duplicate): `$(x)` with gray color
- Tooltip: markdown with full title, body preview, labels, priority, owner
- Click action: opens webview detail panel

### Badge

Activity bar badge shows count of open issues across all discovered projects.

## Webview Detail Panel

Single panel instance, reused across issues (same pattern as roborev).

### Layout

```
┌─ Header ──────────────────────────────────────────
│ [STATUS BADGE]  #26 — Add login flow
│ Owner: cdolan   Priority: 2   Created: May 13, 2026
├─ Labels ──────────────────────────────────────────
│ [feature] [auth]
├─ Body ────────────────────────────────────────────
│ (Markdown rendered as HTML via marked library)
├─ Relationships ───────────────────────────────────
│ Parent: #30 — Auth overhaul
│ Blocks: #27 — Deploy auth service
│ Related: #28 — Update auth docs
├─ Comments (3) ────────────────────────────────────
│ cdolan (2h ago)
│   Started working on this
│
│ claude-code (1h ago)
│   Implemented OAuth flow in auth-service
│
│ cdolan (30m ago)
│   Looks good, needs tests
├─ Actions ─────────────────────────────────────────
│ [Close ▾] [Reopen] [Open TUI]
└───────────────────────────────────────────────────
```

### Status Badges

- **Open**: blue badge
- **Closed (done)**: green badge
- **Closed (wontfix)**: gray badge
- **Closed (duplicate)**: gray badge
### Close Reason Picker

The Close button presents a dropdown with reason options:
- done (default)
- wontfix
- duplicate

Selected via VS Code `showQuickPick` before executing the close command.

### Styling

- Theme-aware CSS using VS Code CSS variables (same approach as roborev)
- Labels rendered as inline pill badges
- Comments rendered with author, relative time, and markdown body
- Relationships rendered as clickable links that open the linked issue in the webview

## CLI Communication (kata-client.ts)

### Binary Discovery

Same strategy as roborev:
1. Try login shell resolution (`$SHELL -lic 'which kata'`)
2. Fall back to common paths (`/usr/local/bin/kata`, homebrew paths)
3. Cache resolved path for session

### Commands

| Operation | Command | Timeout |
|-----------|---------|---------|
| Health check | `kata health --json` | 5s |
| List issues | `kata list --status all --json --workspace <path> --limit 50` | 5s |
| Show issue | `kata show <ref> --json --workspace <path>` | 5s |
| Close issue | `kata close <ref> --reason <reason> --json --workspace <path>` | 10s |
| Reopen issue | `kata reopen <ref> --json --workspace <path>` | 10s |
| Create issue | `kata create <title> --json --workspace <path>` | 10s |
| Poll events | `kata events --after <N> --json --workspace <path> --limit 100` | 5s |

### Error Handling

- Max buffer: 10MB for show, 5MB for list
- Graceful fallback when binary not found — show warning in tree
- Parse errors logged to output channel, stale data shown

## Polling & Refresh

### Event-Driven Polling

Uses `kata events --after <N>` to detect changes efficiently:
1. Store `next_after_id` per project
2. Poll events endpoint on interval
3. If new events returned, trigger tree refresh
4. If `reset_required` is true, reset cursor to 0 and do full refresh

### Intervals

- **Active**: 5s when recent events detected (within last 60s)
- **Idle**: 60s otherwise
- **Focus**: immediate refresh on window focus
- **Manual**: refresh button in view title bar

### Lifecycle

- Polling starts on activation
- Pauses when window loses focus
- Resumes on focus with immediate refresh
- Cleans up on deactivation

## Create Issue Flow

Minimal inline creation via VS Code input boxes:

1. User clicks `+` button or runs `kata.createIssue` command
2. `showInputBox` prompts for title (required)
3. Runs `kata create <title> --json --workspace <path>`
4. Refreshes tree on success
5. Opens newly created issue in webview

## Data Types (types.ts)

```typescript
interface KataIssue {
  id: number;
  uid: string;
  project_id: number;
  project_uid: string;
  number: number;
  title: string;
  body: string | null;
  status: 'open' | 'closed';
  closed_reason: 'done' | 'wontfix' | 'duplicate' | null;
  owner: string | null;
  priority: number | null;  // 0-4, 0=highest
  author: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

interface KataComment {
  id: number;
  issue_id: number;
  author: string;
  body: string;
  created_at: string;
}

interface KataLink {
  id: number;
  project_id: number;
  from: { uid: string; short_id: string };
  to: { uid: string; short_id: string };
  type: 'parent' | 'blocks' | 'related';
  author: string;
  created_at: string;
}

interface KataLabel {
  issue_id: number;
  label: string;
  author: string;
  created_at: string;
}

interface KataListIssue extends KataIssue {
  short_id: string;
  qualified_id: string;
  labels: string[];
  parent_short_id: string | null;
  child_counts: { open: number; total: number } | null;
  blocks: Array<{ uid: string; short_id: string }>;
  blocked_by: Array<{ uid: string; short_id: string }>;
  related: Array<{ uid: string; short_id: string }>;
}

interface KataShowResponse {
  kata_api_version: number;
  issue: KataIssue;
  comments: KataComment[];
  links: KataLink[];
  labels: KataLabel[];
  parent: { uid: string; short_id: string; qualified_id: string; title: string; status: string } | null;
  children: Array<{ uid: string; short_id: string; qualified_id: string; title: string; status: string }>;
}

interface KataListResponse {
  kata_api_version: number;
  issues: KataListIssue[];
}

interface KataEvent {
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

interface KataEventsResponse {
  kata_api_version: number;
  reset_required: boolean;
  events: KataEvent[];
  next_after_id: number;
}

interface KataHealthResponse {
  kata_api_version: number;
  ok: boolean;
  db_path: string;
  schema_version: number;
  version: string;
  uptime: string;
  started_at: string;
}
```

## Out of Scope (v1)

- Inline commenting (add in v2)
- Edit title/body from webview
- Assign/unassign from webview
- Add/remove labels from webview
- Create/manage relationships from webview
- Inline diagnostics or CodeLens
- Multi-project issue cross-references
- Drag-and-drop reordering