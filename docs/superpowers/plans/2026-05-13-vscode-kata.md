# vscode-kata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a VS Code extension that surfaces kata issue tracking in the sidebar, mirroring vscode-roborev's architecture.

**Architecture:** Five TypeScript source files (`types.ts`, `kata-client.ts`, `issue-tree.ts`, `issue-webview.ts`, `extension.ts`) plus scaffolding (package.json, tsconfig, esbuild, .vscode). The CLI client wraps `kata --json` commands. A TreeDataProvider groups issues by Open/Closed. A webview panel renders issue detail with comments, labels, relationships, and actions.

**Tech Stack:** TypeScript (strict), VS Code Extension API, esbuild bundler, `marked` for markdown rendering, `kata` CLI for data.

**Reference:** `/Users/cdolan/Projects/vscode-roborev/src/` — the source files to mirror with kata-specific adaptations.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `package.json` | Create | Extension manifest, dependencies, commands, menus, views |
| `tsconfig.json` | Create | TypeScript config (strict, ES2022, Node16) |
| `esbuild.config.mjs` | Create | Bundler config (CJS, node18, externalize vscode) |
| `.vscodeignore` | Create | Packaging exclude list |
| `.vscode/launch.json` | Create | Extension host debug config |
| `.vscode/tasks.json` | Create | Watch build task |
| `.gitignore` | Modify | Add node_modules, dist |
| `media/kata-icon.svg` | Create | Activity bar icon |
| `src/types.ts` | Create | Kata data interfaces, classification helpers |
| `src/kata-client.ts` | Create | CLI wrapper: binary discovery, spawn, JSON parse |
| `src/issue-tree.ts` | Create | TreeDataProvider: project roots, Open/Closed groups, issue items |
| `src/issue-webview.ts` | Create | Webview panel: issue detail rendering, action handling |
| `src/extension.ts` | Create | Activation, command registration, polling, project discovery |

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `esbuild.config.mjs`
- Create: `.vscodeignore`
- Create: `.vscode/launch.json`
- Create: `.vscode/tasks.json`
- Modify: `.gitignore`
- Create: `media/kata-icon.svg`

- [ ] **Step 1: Update .gitignore**

Add build artifacts and dependencies:

```
.kata.local.toml
node_modules/
dist/
*.vsix
```

- [ ] **Step 2: Create package.json**

```json
{
  "name": "vscode-kata",
  "displayName": "kata",
  "description": "kata issue tracking in VS Code",
  "version": "0.1.0",
  "publisher": "sarcasticbird",
  "icon": "media/kata-icon.png",
  "repository": {
    "type": "git",
    "url": "https://github.com/sarcasticbird/vscode-kata"
  },
  "license": "MIT",
  "engines": {
    "vscode": "^1.85.0"
  },
  "categories": ["Other"],
  "keywords": ["kata", "issue tracking", "task management"],
  "activationEvents": ["onStartupFinished"],
  "main": "./dist/extension.js",
  "contributes": {
    "viewsContainers": {
      "activitybar": [
        {
          "id": "kata",
          "title": "kata",
          "icon": "media/kata-icon.svg"
        }
      ]
    },
    "views": {
      "kata": [
        {
          "id": "kataIssues",
          "name": "Issues"
        }
      ]
    },
    "commands": [
      {
        "command": "kata.refresh",
        "title": "kata: Refresh Issues",
        "icon": "$(refresh)"
      },
      {
        "command": "kata.showIssue",
        "title": "kata: Show Issue"
      },
      {
        "command": "kata.close",
        "title": "kata: Close Issue"
      },
      {
        "command": "kata.reopen",
        "title": "kata: Reopen Issue"
      },
      {
        "command": "kata.createIssue",
        "title": "kata: Create Issue",
        "icon": "$(plus)"
      },
      {
        "command": "kata.openTui",
        "title": "kata: Open TUI",
        "icon": "$(terminal)"
      }
    ],
    "menus": {
      "view/title": [
        {
          "command": "kata.createIssue",
          "when": "view == kataIssues",
          "group": "navigation"
        },
        {
          "command": "kata.openTui",
          "when": "view == kataIssues",
          "group": "navigation"
        },
        {
          "command": "kata.refresh",
          "when": "view == kataIssues",
          "group": "navigation"
        }
      ],
      "view/item/context": [
        {
          "command": "kata.close",
          "when": "view == kataIssues && viewItem == issueOpen"
        },
        {
          "command": "kata.reopen",
          "when": "view == kataIssues && viewItem == issueClosed"
        },
        {
          "command": "kata.openTui",
          "when": "view == kataIssues && viewItem =~ /^issue/"
        }
      ]
    },
    "viewsWelcome": [
      {
        "view": "kataIssues",
        "contents": "No kata projects found.\n\nRun `kata init` in your project to start tracking issues.\n\n[Open Terminal](command:workbench.action.terminal.new)"
      }
    ]
  },
  "scripts": {
    "build": "node esbuild.config.mjs",
    "watch": "node esbuild.config.mjs --watch",
    "package": "vsce package"
  },
  "devDependencies": {
    "@types/vscode": "^1.85.0",
    "@vscode/vsce": "^3.0.0",
    "esbuild": "^0.25.12",
    "typescript": "^5.7.0"
  },
  "dependencies": {
    "marked": "^15.0.0"
  }
}
```

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 4: Create esbuild.config.mjs**

```javascript
import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const ctx = await esbuild.context({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node18",
  sourcemap: true,
});

if (watch) {
  await ctx.watch();
  console.log("Watching for changes...");
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
```

- [ ] **Step 5: Create .vscodeignore**

```
src/**
docs/**
node_modules/**
.flox/**
.git/**
.vscode/**
tsconfig.json
esbuild.config.mjs
*.vsix
```

- [ ] **Step 6: Create .vscode/launch.json**

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Run Extension",
      "type": "extensionHost",
      "request": "launch",
      "args": [
        "--extensionDevelopmentPath=${workspaceFolder}"
      ],
      "outFiles": ["${workspaceFolder}/dist/**/*.js"],
      "preLaunchTask": "${defaultBuildTask}"
    }
  ]
}
```

- [ ] **Step 7: Create .vscode/tasks.json**

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "type": "npm",
      "script": "watch",
      "isBackground": true,
      "problemMatcher": "$esbuild-watch",
      "label": "npm: watch",
      "group": {
        "kind": "build",
        "isDefault": true
      }
    }
  ]
}
```

- [ ] **Step 8: Create media/kata-icon.svg**

A simple SVG icon — a checklist/task icon:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M9 11l3 3L22 4"/>
  <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
</svg>
```

- [ ] **Step 9: Install dependencies and verify build**

```bash
cd /Users/cdolan/Projects/vscode-kata
flox activate -c 'npm install'
```

Create a minimal `src/extension.ts` stub to verify the build works:

```typescript
import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel("kata");
  outputChannel.appendLine("kata extension activated");
  context.subscriptions.push(outputChannel);
}

export function deactivate(): void {}
```

Then build:

```bash
flox activate -c 'npm run build'
```

Expected: `dist/extension.js` and `dist/extension.js.map` created without errors.

- [ ] **Step 10: Commit**

```bash
git add .gitignore package.json package-lock.json tsconfig.json esbuild.config.mjs .vscodeignore .vscode/ media/ src/extension.ts
git commit -m "feat: scaffold vscode-kata extension project"
```

---

### Task 2: Data Types

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: Create types.ts with all kata interfaces**

```typescript
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
  from: { uid: string; short_id: string };
  to: { uid: string; short_id: string };
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
  short_id: string;
  qualified_id: string;
  labels: string[];
  parent_short_id: string | null;
  child_counts: { open: number; total: number } | null;
  blocks: Array<{ uid: string; short_id: string }>;
  blocked_by: Array<{ uid: string; short_id: string }>;
  related: Array<{ uid: string; short_id: string }>;
}

export interface KataShowResponse {
  kata_api_version: number;
  issue: KataIssue;
  comments: KataComment[];
  links: KataLink[];
  labels: KataLabel[];
  parent: {
    uid: string;
    short_id: string;
    qualified_id: string;
    title: string;
    status: string;
  } | null;
  children: Array<{
    uid: string;
    short_id: string;
    qualified_id: string;
    title: string;
    status: string;
  }>;
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
```

- [ ] **Step 2: Verify build**

```bash
flox activate -c 'npm run build'
```

Expected: build succeeds (types are exported but unused — esbuild bundles fine).

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add kata data type interfaces"
```

---

### Task 3: CLI Client

**Files:**
- Create: `src/kata-client.ts`

- [ ] **Step 1: Create kata-client.ts**

This is the full implementation, mirroring `roborev-client.ts` but calling `kata` CLI commands:

```typescript
import { execFile } from "node:child_process";
import * as vscode from "vscode";
import type {
  KataListResponse,
  KataShowResponse,
  KataEventsResponse,
  KataHealthResponse,
  KataCreateResponse,
} from "./types.js";

const HOMEBREW_PATHS = [
  "/opt/homebrew/bin/kata",
  "/usr/local/bin/kata",
];

export class KataClient {
  private outputChannel: vscode.OutputChannel;
  private resolvedBinary: string | null = null;

  constructor(outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel;
  }

  async isAvailable(): Promise<boolean> {
    try {
      this.resolvedBinary = await this.findBinary();
      if (!this.resolvedBinary) {
        this.outputChannel.appendLine("binary resolution failed: kata not found");
        this.outputChannel.appendLine(`process.env.PATH: ${process.env.PATH}`);
        return false;
      }
      await this.exec(["health", "--json"]);
      return true;
    } catch (err) {
      this.outputChannel.appendLine(`isAvailable error: ${err}`);
      return false;
    }
  }

  private async findBinary(): Promise<string | null> {
    if (this.resolvedBinary) {
      return this.resolvedBinary;
    }

    const shell = process.env.SHELL ?? "/bin/zsh";
    this.outputChannel.appendLine(
      `attempting shell resolve via: ${shell} -l -c "which kata"`
    );
    try {
      const path = await this.shellResolve("kata");
      if (path) {
        this.outputChannel.appendLine(`resolved kata at: ${path}`);
        return path;
      }
      this.outputChannel.appendLine("shell resolve returned empty");
    } catch (err) {
      this.outputChannel.appendLine(`shell resolve failed: ${err}`);
    }

    const { accessSync, constants } = await import("node:fs");
    for (const candidate of HOMEBREW_PATHS) {
      this.outputChannel.appendLine(`checking: ${candidate}`);
      try {
        accessSync(candidate, constants.X_OK);
        this.outputChannel.appendLine(`found kata at: ${candidate}`);
        return candidate;
      } catch (err) {
        this.outputChannel.appendLine(`  not found: ${err}`);
        continue;
      }
    }

    return null;
  }

  private shellResolve(binary: string): Promise<string | null> {
    return new Promise((resolve) => {
      const shell = process.env.SHELL ?? "/bin/zsh";
      execFile(
        shell,
        ["-l", "-c", `which ${binary}`],
        { timeout: 5_000 },
        (error, stdout) => {
          if (error) {
            resolve(null);
            return;
          }
          const path = stdout.trim();
          resolve(path || null);
        }
      );
    });
  }

  async listIssues(workspacePath: string): Promise<KataListResponse> {
    const output = await this.exec([
      "list",
      "--status", "all",
      "--json",
      "--workspace", workspacePath,
      "--limit", "50",
    ]);
    return JSON.parse(output) as KataListResponse;
  }

  async showIssue(
    issueRef: string,
    workspacePath: string
  ): Promise<KataShowResponse> {
    const output = await this.exec([
      "show",
      issueRef,
      "--json",
      "--workspace", workspacePath,
    ], { maxBuffer: 10 * 1024 * 1024 });
    return JSON.parse(output) as KataShowResponse;
  }

  async closeIssue(
    issueRef: string,
    reason: string,
    workspacePath: string
  ): Promise<void> {
    await this.exec([
      "close",
      issueRef,
      "--reason", reason,
      "--json",
      "--workspace", workspacePath,
    ], { timeout: 10_000 });
  }

  async reopenIssue(
    issueRef: string,
    workspacePath: string
  ): Promise<void> {
    await this.exec([
      "reopen",
      issueRef,
      "--json",
      "--workspace", workspacePath,
    ], { timeout: 10_000 });
  }

  async createIssue(
    title: string,
    workspacePath: string
  ): Promise<KataCreateResponse> {
    const output = await this.exec([
      "create",
      title,
      "--json",
      "--workspace", workspacePath,
    ], { timeout: 10_000 });
    return JSON.parse(output) as KataCreateResponse;
  }

  async pollEvents(
    workspacePath: string,
    afterId: number
  ): Promise<KataEventsResponse> {
    const output = await this.exec([
      "events",
      "--after", String(afterId),
      "--json",
      "--workspace", workspacePath,
      "--limit", "100",
    ]);
    return JSON.parse(output) as KataEventsResponse;
  }

  private exec(
    args: string[],
    options?: { timeout?: number; maxBuffer?: number }
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const binary = this.resolvedBinary ?? "kata";
      const timeout = options?.timeout ?? 5_000;
      const maxBuffer = options?.maxBuffer ?? 5 * 1024 * 1024;
      this.outputChannel.appendLine(`${binary} ${args.join(" ")}`);

      execFile(
        binary,
        args,
        { timeout, maxBuffer },
        (error, stdout, stderr) => {
          if (error) {
            this.outputChannel.appendLine(`error: ${error.message}`);
            if (stderr) {
              this.outputChannel.appendLine(`stderr: ${stderr}`);
            }
            reject(error);
            return;
          }
          resolve(stdout);
        }
      );
    });
  }
}
```

- [ ] **Step 2: Verify build**

```bash
flox activate -c 'npm run build'
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/kata-client.ts
git commit -m "feat: add kata CLI client wrapper"
```

---

### Task 4: Tree View Provider

**Files:**
- Create: `src/issue-tree.ts`

- [ ] **Step 1: Create issue-tree.ts**

```typescript
import * as vscode from "vscode";
import type { KataClient } from "./kata-client.js";
import {
  type KataListIssue,
  type IssueGroup,
  classifyIssue,
  relativeTime,
} from "./types.js";

const GROUP_LABELS: Record<IssueGroup, string> = {
  open: "Open",
  closed: "Closed",
};

const GROUP_ICONS: Record<IssueGroup, vscode.ThemeIcon> = {
  open: new vscode.ThemeIcon(
    "circle-filled",
    new vscode.ThemeColor("charts.blue")
  ),
  closed: new vscode.ThemeIcon(
    "check",
    new vscode.ThemeColor("testing.iconPassed")
  ),
};

const GROUP_ORDER: IssueGroup[] = ["open", "closed"];

interface ProjectData {
  name: string;
  path: string;
  issues: KataListIssue[];
}

export class IssueTreeProvider
  implements vscode.TreeDataProvider<IssueTreeItem>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<
    IssueTreeItem | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private projects: ProjectData[] = [];
  private client: KataClient;
  private projectPaths: { name: string; path: string }[];
  private available = true;
  private errorMessage: string | null = null;
  private _openCount = 0;

  get openCount(): number {
    return this._openCount;
  }

  constructor(
    client: KataClient,
    projectPaths: { name: string; path: string }[]
  ) {
    this.client = client;
    this.projectPaths = projectPaths;
  }

  updateProjectPaths(projectPaths: { name: string; path: string }[]): void {
    this.projectPaths = projectPaths;
  }

  async refresh(): Promise<void> {
    try {
      this.available = await this.client.isAvailable();
      if (!this.available) {
        this.errorMessage =
          "kata CLI not found — install from github.com/sarcasticbird/kata";
        this.projects = [];
        this._openCount = 0;
        this._onDidChangeTreeData.fire();
        return;
      }
      this.errorMessage = null;

      const results = await Promise.all(
        this.projectPaths.map(async (proj) => {
          const response = await this.client
            .listIssues(proj.path)
            .catch(() => ({ kata_api_version: 1, issues: [] }));
          return { name: proj.name, path: proj.path, issues: response.issues };
        })
      );

      this.projects = results;
      this._openCount = 0;
      for (const proj of this.projects) {
        for (const issue of proj.issues) {
          if (issue.status === "open") {
            this._openCount++;
          }
        }
      }
    } catch (err) {
      this.errorMessage =
        err instanceof Error ? err.message : "Failed to load issues";
      this.projects = [];
      this._openCount = 0;
    }
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: IssueTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: IssueTreeItem): IssueTreeItem[] {
    if (!element) {
      return this.getRootItems();
    }
    if (element.projectName && !element.group) {
      return this.getProjectGroups(element.projectName);
    }
    if (element.group && element.projectName) {
      return this.getGroupChildren(element.projectName, element.group);
    }
    return [];
  }

  private getRootItems(): IssueTreeItem[] {
    if (!this.available || this.errorMessage) {
      const item = new IssueTreeItem(
        this.errorMessage ?? "kata CLI not found",
        vscode.TreeItemCollapsibleState.None
      );
      item.iconPath = new vscode.ThemeIcon("warning");
      return [item];
    }

    if (this.projects.length === 0) {
      return [];
    }

    return this.projects.map((proj) => {
      const openCount = proj.issues.filter(
        (i) => i.status === "open"
      ).length;
      const item = new IssueTreeItem(
        proj.name,
        proj.issues.length > 0
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.None
      );
      item.iconPath = new vscode.ThemeIcon("project");
      item.description = `${openCount} open`;
      item.projectName = proj.name;
      return item;
    });
  }

  private getProjectGroups(projectName: string): IssueTreeItem[] {
    const proj = this.projects.find((p) => p.name === projectName);
    if (!proj) return [];

    const grouped = new Map<IssueGroup, KataListIssue[]>();
    for (const g of GROUP_ORDER) {
      grouped.set(g, []);
    }
    for (const issue of proj.issues) {
      grouped.get(classifyIssue(issue))!.push(issue);
    }

    return GROUP_ORDER.filter((g) => grouped.get(g)!.length > 0).map((g) => {
      const groupIssues = grouped.get(g)!;
      const item = new IssueTreeItem(
        GROUP_LABELS[g],
        g === "closed"
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.Expanded
      );
      item.iconPath = GROUP_ICONS[g];
      item.description = `(${groupIssues.length})`;
      item.group = g;
      item.projectName = projectName;
      return item;
    });
  }

  private getGroupChildren(
    projectName: string,
    group: IssueGroup
  ): IssueTreeItem[] {
    const proj = this.projects.find((p) => p.name === projectName);
    if (!proj) return [];

    return proj.issues
      .filter((i) => classifyIssue(i) === group)
      .map((issue) => {
        const title =
          issue.title.length > 50
            ? issue.title.slice(0, 47) + "..."
            : issue.title;

        const item = new IssueTreeItem(
          `#${issue.number} — ${title}`,
          vscode.TreeItemCollapsibleState.None
        );

        const parts: string[] = [];
        if (issue.owner) parts.push(issue.owner);
        parts.push(relativeTime(issue.updated_at));
        item.description = parts.join(" · ");

        const tooltipLines = [`**#${issue.number} — ${issue.title}**`];
        if (issue.body) {
          const preview =
            issue.body.length > 200
              ? issue.body.slice(0, 197) + "..."
              : issue.body;
          tooltipLines.push(preview);
        }
        if (issue.labels.length > 0) {
          tooltipLines.push(`**Labels:** ${issue.labels.join(", ")}`);
        }
        if (issue.priority !== null) {
          tooltipLines.push(`**Priority:** ${issue.priority}`);
        }
        if (issue.owner) {
          tooltipLines.push(`**Owner:** ${issue.owner}`);
        }
        item.tooltip = new vscode.MarkdownString(tooltipLines.join("\n\n"));

        item.issueNumber = issue.number;
        item.workspacePath = proj.path;

        if (issue.status === "open") {
          item.contextValue = "issueOpen";
          item.iconPath = new vscode.ThemeIcon(
            "circle-filled",
            new vscode.ThemeColor("charts.blue")
          );
        } else if (issue.closed_reason === "done") {
          item.contextValue = "issueClosed";
          item.iconPath = new vscode.ThemeIcon(
            "check",
            new vscode.ThemeColor("testing.iconPassed")
          );
        } else {
          item.contextValue = "issueClosed";
          item.iconPath = new vscode.ThemeIcon(
            "x",
            new vscode.ThemeColor("descriptionForeground")
          );
        }

        item.command = {
          command: "kata.showIssue",
          title: "Show Issue",
          arguments: [String(issue.number), proj.path],
        };

        return item;
      });
  }
}

export class IssueTreeItem extends vscode.TreeItem {
  group?: IssueGroup;
  projectName?: string;
  issueNumber?: number;
  workspacePath?: string;
}
```

- [ ] **Step 2: Verify build**

```bash
flox activate -c 'npm run build'
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/issue-tree.ts
git commit -m "feat: add issue tree view provider"
```

---

### Task 5: Webview Detail Panel

**Files:**
- Create: `src/issue-webview.ts`

- [ ] **Step 1: Create issue-webview.ts**

```typescript
import * as vscode from "vscode";
import { marked } from "marked";
import type { KataClient } from "./kata-client.js";
import type { KataShowResponse } from "./types.js";
import { relativeTime } from "./types.js";

export class IssueWebviewManager {
  private panel: vscode.WebviewPanel | undefined;
  private client: KataClient;
  private outputChannel: vscode.OutputChannel;

  constructor(
    client: KataClient,
    outputChannel: vscode.OutputChannel,
    private readonly onAction: (
      action: string,
      issueRef: string,
      workspacePath: string,
      reason?: string
    ) => Promise<void>
  ) {
    this.client = client;
    this.outputChannel = outputChannel;
  }

  async show(issueRef: string, workspacePath: string): Promise<void> {
    let data: KataShowResponse;
    try {
      data = await this.client.showIssue(issueRef, workspacePath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      vscode.window.showErrorMessage(`Failed to load issue: ${msg}`);
      return;
    }

    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
    } else {
      this.panel = vscode.window.createWebviewPanel(
        "kataIssue",
        "kata",
        vscode.ViewColumn.One,
        { enableScripts: true, retainContextWhenHidden: false }
      );
      this.panel.onDidDispose(() => {
        this.panel = undefined;
      });
      this.panel.webview.onDidReceiveMessage(async (msg) => {
        if (msg.command === "close") {
          const reason = await vscode.window.showQuickPick(
            ["done", "wontfix", "duplicate"],
            { placeHolder: "Select close reason" }
          );
          if (!reason) return;
          await this.onAction("close", msg.issueRef, msg.workspacePath, reason);
          await this.show(msg.issueRef, msg.workspacePath);
        }
        if (msg.command === "reopen") {
          await this.onAction("reopen", msg.issueRef, msg.workspacePath);
          await this.show(msg.issueRef, msg.workspacePath);
        }
        if (msg.command === "openTui") {
          vscode.commands.executeCommand("kata.openTui");
        }
        if (msg.command === "showIssue") {
          await this.show(msg.issueRef, msg.workspacePath);
        }
      });
    }

    const issue = data.issue;
    this.panel.title = `kata: #${issue.number} — ${issue.title}`;
    this.panel.webview.html = this.buildHtml(data, workspacePath);
  }

  dispose(): void {
    this.panel?.dispose();
  }

  private buildHtml(data: KataShowResponse, workspacePath: string): string {
    const issue = data.issue;
    const issueRef = String(issue.number);

    const statusLabel =
      issue.status === "open"
        ? "Open"
        : issue.closed_reason
          ? issue.closed_reason.charAt(0).toUpperCase() +
            issue.closed_reason.slice(1)
          : "Closed";
    const statusClass =
      issue.status === "open"
        ? "open"
        : issue.closed_reason === "done"
          ? "done"
          : "closed";

    const actionButtons =
      issue.status === "open"
        ? `<button class="btn btn-primary" onclick="postMessage({ command: 'close', issueRef: '${issueRef}', workspacePath: '${escapeHtml(workspacePath)}' })">Close</button>`
        : `<button class="btn btn-secondary" onclick="postMessage({ command: 'reopen', issueRef: '${issueRef}', workspacePath: '${escapeHtml(workspacePath)}' })">Reopen</button>`;

    const labelsHtml =
      data.labels.length > 0
        ? `<div class="labels">${data.labels.map((l) => `<span class="label">${escapeHtml(l.label)}</span>`).join(" ")}</div>`
        : "";

    const bodyHtml = issue.body
      ? (marked.parse(issue.body, { async: false }) as string)
      : '<span class="muted">No description</span>';

    const relationshipsHtml = this.buildRelationshipsHtml(data, workspacePath);

    const commentsHtml =
      data.comments.length > 0
        ? `<div class="comments">
        <h3>Comments (${data.comments.length})</h3>
        ${data.comments
          .map(
            (c) => `<div class="comment">
            <div class="comment-header">
              <strong>${escapeHtml(c.author)}</strong>
              <span class="muted">${relativeTime(c.created_at)}</span>
            </div>
            <div class="comment-body">${marked.parse(c.body, { async: false }) as string}</div>
          </div>`
          )
          .join("\n")}
      </div>`
        : "";

    const priorityDisplay =
      issue.priority !== null ? String(issue.priority) : "—";
    const ownerDisplay = issue.owner ?? "unassigned";

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      padding: 16px;
      line-height: 1.6;
    }
    .header {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      margin-bottom: 8px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--vscode-widget-border);
    }
    .header-title {
      font-size: 1.2em;
      font-weight: bold;
      flex-basis: 100%;
    }
    .header-field {
      font-size: 0.85em;
      color: var(--vscode-descriptionForeground);
    }
    .header-field strong {
      color: var(--vscode-editor-foreground);
    }
    .status {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 0.85em;
      font-weight: bold;
    }
    .status.open {
      background: var(--vscode-inputValidation-infoBackground);
      color: var(--vscode-charts-blue, #3794ff);
    }
    .status.done {
      background: var(--vscode-inputValidation-infoBackground);
      color: var(--vscode-testing-iconPassed);
    }
    .status.closed {
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
    }
    .labels {
      margin: 8px 0;
    }
    .label {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 0.8em;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      margin-right: 4px;
    }
    .actions {
      display: flex;
      gap: 8px;
      margin-bottom: 16px;
    }
    .btn {
      padding: 4px 12px;
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.85em;
    }
    .btn-primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .btn-primary:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .btn-secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    .btn-secondary:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
    .body {
      margin: 16px 0;
    }
    .body pre {
      background: var(--vscode-textCodeBlock-background);
      padding: 12px;
      border-radius: 4px;
      overflow-x: auto;
    }
    .body code {
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
    }
    .relationships {
      margin: 16px 0;
      padding: 12px;
      background: var(--vscode-textCodeBlock-background);
      border-radius: 4px;
    }
    .relationships h3 {
      margin: 0 0 8px 0;
      font-size: 0.95em;
    }
    .rel-item {
      display: flex;
      gap: 8px;
      align-items: center;
      padding: 2px 0;
    }
    .rel-type {
      font-size: 0.8em;
      font-weight: bold;
      color: var(--vscode-descriptionForeground);
      min-width: 60px;
    }
    .rel-link {
      color: var(--vscode-textLink-foreground);
      cursor: pointer;
      text-decoration: none;
    }
    .rel-link:hover {
      text-decoration: underline;
    }
    .comments {
      margin-top: 16px;
      padding-top: 16px;
      border-top: 1px solid var(--vscode-widget-border);
    }
    .comments h3 {
      margin: 0 0 12px 0;
      font-size: 0.95em;
    }
    .comment {
      margin-bottom: 12px;
      padding: 8px 12px;
      background: var(--vscode-textCodeBlock-background);
      border-radius: 4px;
    }
    .comment-header {
      display: flex;
      gap: 8px;
      align-items: center;
      margin-bottom: 4px;
      font-size: 0.85em;
    }
    .comment-body {
      font-size: 0.95em;
    }
    .comment-body p:first-child {
      margin-top: 0;
    }
    .comment-body p:last-child {
      margin-bottom: 0;
    }
    .muted {
      color: var(--vscode-descriptionForeground);
    }
  </style>
</head>
<body>
  <div class="header">
    <span class="status ${statusClass}">${statusLabel}</span>
    <span class="header-title">#${issue.number} — ${escapeHtml(issue.title)}</span>
    <span class="header-field"><strong>Owner:</strong> ${escapeHtml(ownerDisplay)}</span>
    <span class="header-field"><strong>Priority:</strong> ${priorityDisplay}</span>
    <span class="header-field"><strong>Created:</strong> ${relativeTime(issue.created_at)}</span>
  </div>
  ${labelsHtml}
  <div class="actions">
    ${actionButtons}
    <button class="btn btn-secondary" onclick="postMessage({ command: 'openTui' })">Open TUI</button>
  </div>
  <div class="body">${bodyHtml}</div>
  ${relationshipsHtml}
  ${commentsHtml}
  <script>
    const vscode = acquireVsCodeApi();
    function postMessage(msg) {
      vscode.postMessage(msg);
    }
  </script>
</body>
</html>`;
  }

  private buildRelationshipsHtml(
    data: KataShowResponse,
    workspacePath: string
  ): string {
    const items: string[] = [];

    if (data.parent) {
      items.push(
        `<div class="rel-item">
          <span class="rel-type">Parent</span>
          <a class="rel-link" href="#" onclick="postMessage({ command: 'showIssue', issueRef: '${data.parent.short_id}', workspacePath: '${escapeHtml(workspacePath)}' }); return false">
            #${escapeHtml(data.parent.short_id)} — ${escapeHtml(data.parent.title)}
          </a>
          <span class="muted">(${data.parent.status})</span>
        </div>`
      );
    }

    if (data.children.length > 0) {
      for (const child of data.children) {
        items.push(
          `<div class="rel-item">
            <span class="rel-type">Child</span>
            <a class="rel-link" href="#" onclick="postMessage({ command: 'showIssue', issueRef: '${child.short_id}', workspacePath: '${escapeHtml(workspacePath)}' }); return false">
              #${escapeHtml(child.short_id)} — ${escapeHtml(child.title)}
            </a>
            <span class="muted">(${child.status})</span>
          </div>`
        );
      }
    }

    for (const link of data.links) {
      if (link.type === "parent") continue;
      const label = link.type === "blocks" ? "Blocks" : "Related";
      items.push(
        `<div class="rel-item">
          <span class="rel-type">${label}</span>
          <a class="rel-link" href="#" onclick="postMessage({ command: 'showIssue', issueRef: '${link.to.short_id}', workspacePath: '${escapeHtml(workspacePath)}' }); return false">
            #${escapeHtml(link.to.short_id)}
          </a>
        </div>`
      );
    }

    if (items.length === 0) return "";

    return `<div class="relationships">
      <h3>Relationships</h3>
      ${items.join("\n")}
    </div>`;
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
```

- [ ] **Step 2: Verify build**

```bash
flox activate -c 'npm run build'
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/issue-webview.ts
git commit -m "feat: add issue webview detail panel"
```

---

### Task 6: Extension Entry Point

**Files:**
- Modify: `src/extension.ts` (replace the stub from Task 1)

- [ ] **Step 1: Replace extension.ts with full implementation**

```typescript
import * as vscode from "vscode";
import * as path from "node:path";
import * as fs from "node:fs";
import { KataClient } from "./kata-client.js";
import { IssueTreeProvider } from "./issue-tree.js";
import { IssueWebviewManager } from "./issue-webview.js";

let pollTimer: ReturnType<typeof setTimeout> | undefined;

function discoverProjects(
  folders: readonly vscode.WorkspaceFolder[],
  outputChannel: vscode.OutputChannel
): { name: string; path: string }[] {
  const projects: { name: string; path: string }[] = [];
  const seen = new Set<string>();

  for (const folder of folders) {
    const root = folder.uri.fsPath;
    addIfKataProject(root, seen, projects);

    try {
      const entries = fs.readdirSync(root, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
        addIfKataProject(path.join(root, entry.name), seen, projects);
      }
    } catch {
      continue;
    }
  }

  outputChannel.appendLine(
    `discovered ${projects.length} kata project(s): ${projects.map((p) => p.name).join(", ")}`
  );
  return projects;
}

function addIfKataProject(
  dir: string,
  seen: Set<string>,
  projects: { name: string; path: string }[]
): void {
  const tomlPath = path.join(dir, ".kata.toml");
  if (!fs.existsSync(tomlPath) || seen.has(dir)) return;
  seen.add(dir);

  let name = path.basename(dir);
  try {
    const content = fs.readFileSync(tomlPath, "utf-8");
    const match = content.match(/^name\s*=\s*"([^"]+)"/m);
    if (match) name = match[1];
  } catch {
    // fall back to directory name
  }

  projects.push({ name, path: dir });
}

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel("kata");
  context.subscriptions.push(outputChannel);

  const client = new KataClient(outputChannel);

  const initialFolders = vscode.workspace.workspaceFolders ?? [];
  const projectPaths =
    initialFolders.length > 0
      ? discoverProjects(initialFolders, outputChannel)
      : [];

  const treeProvider = new IssueTreeProvider(client, projectPaths);

  const treeView = vscode.window.createTreeView("kataIssues", {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  const updateBadge = () => {
    const count = treeProvider.openCount;
    treeView.badge =
      count > 0
        ? {
            value: count,
            tooltip: `${count} open issue${count === 1 ? "" : "s"}`,
          }
        : undefined;
  };

  const rediscoverProjects = async () => {
    const folders = vscode.workspace.workspaceFolders;
    const newPaths =
      folders && folders.length > 0
        ? discoverProjects(folders, outputChannel)
        : [];
    treeProvider.updateProjectPaths(newPaths);
    await treeProvider.refresh();
    updateBadge();
  };

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      rediscoverProjects().catch((err) =>
        outputChannel.appendLine(`rediscoverProjects failed: ${err}`)
      );
    })
  );

  const webviewManager = new IssueWebviewManager(
    client,
    outputChannel,
    async (action, issueRef, workspacePath, reason) => {
      if (action === "close" && reason) {
        await client.closeIssue(issueRef, reason, workspacePath);
      } else if (action === "reopen") {
        await client.reopenIssue(issueRef, workspacePath);
      }
      await treeProvider.refresh();
      updateBadge();
    }
  );
  context.subscriptions.push({ dispose: () => webviewManager.dispose() });

  context.subscriptions.push(
    vscode.commands.registerCommand("kata.refresh", async () => {
      await treeProvider.refresh();
      updateBadge();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "kata.showIssue",
      (issueRef: string, workspacePath: string) => {
        return webviewManager.show(issueRef, workspacePath);
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "kata.close",
      async (item: { issueNumber?: number; workspacePath?: string }) => {
        if (item.issueNumber && item.workspacePath) {
          const reason = await vscode.window.showQuickPick(
            ["done", "wontfix", "duplicate"],
            { placeHolder: "Select close reason" }
          );
          if (!reason) return;
          await client.closeIssue(
            String(item.issueNumber),
            reason,
            item.workspacePath
          );
          await treeProvider.refresh();
          updateBadge();
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "kata.reopen",
      async (item: { issueNumber?: number; workspacePath?: string }) => {
        if (item.issueNumber && item.workspacePath) {
          await client.reopenIssue(
            String(item.issueNumber),
            item.workspacePath
          );
          await treeProvider.refresh();
          updateBadge();
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("kata.createIssue", async () => {
      const title = await vscode.window.showInputBox({
        prompt: "Issue title",
        placeHolder: "Enter a title for the new issue",
      });
      if (!title) return;

      const workspacePath = projectPaths[0]?.path;
      if (!workspacePath) {
        vscode.window.showWarningMessage(
          "No kata project found. Run `kata init` first."
        );
        return;
      }

      try {
        const response = await client.createIssue(title, workspacePath);
        await treeProvider.refresh();
        updateBadge();
        await webviewManager.show(
          String(response.issue.number),
          workspacePath
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        vscode.window.showErrorMessage(`Failed to create issue: ${msg}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("kata.openTui", () => {
      const existingTerminal = vscode.window.terminals.find(
        (t) => t.name === "kata TUI"
      );
      if (existingTerminal) {
        existingTerminal.show();
        return;
      }
      const folders = vscode.workspace.workspaceFolders;
      const cwd = folders?.[0]?.uri.fsPath;
      const terminal = vscode.window.createTerminal({
        name: "kata TUI",
        ...(cwd ? { cwd } : {}),
      });
      terminal.sendText("kata tui");
      terminal.show();
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeWindowState(async (state) => {
      if (state.focused) {
        await treeProvider.refresh();
        updateBadge();
      }
    })
  );

  const POLL_FAST = 5_000;
  const POLL_IDLE = 60_000;
  let pollDisposed = false;
  let lastEventActivity = 0;

  const schedulePoll = () => {
    if (pollDisposed) return;
    const isActive = Date.now() - lastEventActivity < 60_000;
    pollTimer = setTimeout(async () => {
      try {
        if (vscode.window.state.focused) {
          await treeProvider.refresh();
          updateBadge();
          lastEventActivity = Date.now();
        }
      } finally {
        schedulePoll();
      }
    }, isActive ? POLL_FAST : POLL_IDLE);
  };
  schedulePoll();
  context.subscriptions.push({
    dispose: () => {
      pollDisposed = true;
      clearTimeout(pollTimer);
    },
  });

  if (initialFolders.length > 0) {
    treeProvider.refresh().then(updateBadge);
  }
}

export function deactivate(): void {
  if (pollTimer) {
    clearTimeout(pollTimer);
  }
}
```

- [ ] **Step 2: Verify build**

```bash
flox activate -c 'npm run build'
```

Expected: `dist/extension.js` built, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/extension.ts
git commit -m "feat: add extension entry point with project discovery and polling"
```

---

### Task 7: Build, Package, and Smoke Test

**Files:**
- No new files

- [ ] **Step 1: Full build**

```bash
cd /Users/cdolan/Projects/vscode-kata
flox activate -c 'npm run build'
```

Expected: `dist/extension.js` and `dist/extension.js.map` created.

- [ ] **Step 2: Package as VSIX**

```bash
flox activate -c 'npx vsce package --allow-missing-repository'
```

Expected: `vscode-kata-0.1.0.vsix` created. (May need `--allow-missing-repository` if the repo URL doesn't resolve yet.)

- [ ] **Step 3: Install and test**

Install the extension in VS Code:

```bash
code --install-extension vscode-kata-0.1.0.vsix
```

Test checklist:
1. Open a workspace containing a project with `.kata.toml`
2. Verify the kata icon appears in the activity bar
3. Click it — sidebar shows the project name and Open/Closed groups
4. Create an issue via the `+` button — verify it appears in the tree
5. Click an issue — verify the webview detail panel opens with header, body, labels, relationships, comments
6. Close an issue from the context menu — verify reason picker appears, issue moves to Closed group
7. Reopen the issue — verify it moves back to Open
8. Open TUI — verify a terminal opens with `kata tui` running

- [ ] **Step 4: Commit the VSIX to .gitignore check and final commit**

Verify `.vsix` files are in `.gitignore`. Then:

```bash
git add -A
git commit -m "feat: complete vscode-kata v0.1.0 extension"
```
