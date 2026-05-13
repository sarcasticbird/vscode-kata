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

    const labels = data.labels ?? [];
    const labelsHtml =
      labels.length > 0
        ? `<div class="labels">${labels.map((l) => `<span class="label">${escapeHtml(l.label)}</span>`).join(" ")}</div>`
        : "";

    const bodyHtml = issue.body
      ? (marked.parse(issue.body, { async: false }) as string)
      : '<span class="muted">No description</span>';

    const relationshipsHtml = this.buildRelationshipsHtml(data, workspacePath);

    const comments = data.comments ?? [];
    const commentsHtml =
      comments.length > 0
        ? `<div class="comments">
        <h3>Comments (${comments.length})</h3>
        ${comments
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
    const children = data.children ?? [];
    const links = data.links ?? [];

    if (data.parent) {
      const parentRef = String(data.parent.number ?? data.parent.short_id ?? "");
      const parentTitle = data.parent.title ?? "";
      items.push(
        `<div class="rel-item">
          <span class="rel-type">Parent</span>
          <a class="rel-link" href="#" onclick="postMessage({ command: 'showIssue', issueRef: '${parentRef}', workspacePath: '${escapeHtml(workspacePath)}' }); return false">
            #${escapeHtml(parentRef)} — ${escapeHtml(parentTitle)}
          </a>
          <span class="muted">(${data.parent.status})</span>
        </div>`
      );
    }

    for (const child of children) {
      const childRef = String((child as Record<string, unknown>).number ?? (child as Record<string, unknown>).short_id ?? "");
      const childTitle = ((child as Record<string, unknown>).title as string) ?? "";
      const childStatus = ((child as Record<string, unknown>).status as string) ?? "";
      items.push(
        `<div class="rel-item">
          <span class="rel-type">Child</span>
          <a class="rel-link" href="#" onclick="postMessage({ command: 'showIssue', issueRef: '${childRef}', workspacePath: '${escapeHtml(workspacePath)}' }); return false">
            #${escapeHtml(childRef)} — ${escapeHtml(childTitle)}
          </a>
          <span class="muted">(${childStatus})</span>
        </div>`
      );
    }

    for (const link of links) {
      if (link.type === "parent") continue;
      const label = link.type === "blocks" ? "Blocks" : "Related";
      const targetRef = String(link.to_number ?? link.to?.short_id ?? "");
      items.push(
        `<div class="rel-item">
          <span class="rel-type">${label}</span>
          <a class="rel-link" href="#" onclick="postMessage({ command: 'showIssue', issueRef: '${targetRef}', workspacePath: '${escapeHtml(workspacePath)}' }); return false">
            #${escapeHtml(targetRef)}
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
