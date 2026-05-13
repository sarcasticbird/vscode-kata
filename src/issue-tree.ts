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
          "kata CLI not found — install from github.com/wesm/kata";
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
          `#${issue.short_id} — ${title}`,
          vscode.TreeItemCollapsibleState.None
        );

        const parts: string[] = [];
        if (issue.owner) parts.push(issue.owner);
        parts.push(relativeTime(issue.updated_at));
        item.description = parts.join(" · ");

        const tooltipLines = [`**#${issue.short_id} — ${issue.title}**`];
        if (issue.body) {
          const preview =
            issue.body.length > 200
              ? issue.body.slice(0, 197) + "..."
              : issue.body;
          tooltipLines.push(preview);
        }
        if (issue.labels && issue.labels.length > 0) {
          tooltipLines.push(`**Labels:** ${issue.labels.join(", ")}`);
        }
        if (issue.priority !== null) {
          tooltipLines.push(`**Priority:** ${issue.priority}`);
        }
        if (issue.owner) {
          tooltipLines.push(`**Owner:** ${issue.owner}`);
        }
        item.tooltip = new vscode.MarkdownString(tooltipLines.join("\n\n"));

        item.issueRef = issue.short_id;
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
          arguments: [issue.short_id, proj.path],
        };

        return item;
      });
  }
}

export class IssueTreeItem extends vscode.TreeItem {
  group?: IssueGroup;
  projectName?: string;
  issueRef?: string;
  workspacePath?: string;
}
