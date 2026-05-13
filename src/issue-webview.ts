import * as vscode from "vscode";
import * as crypto from "node:crypto";
import { marked } from "marked";
import type { KataClient } from "./kata-client.js";
import type { KataShowResponse } from "./types.js";
import { relativeTime } from "./types.js";

marked.use({
  renderer: {
    html() {
      return "";
    },
  },
});

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
    ) => Promise<void>,
    private readonly onMutation?: () => void
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
        if (msg.command === "addComment") {
          try {
            await this.client.addComment(msg.issueRef, msg.body, msg.workspacePath);
            this.onMutation?.();
            await this.show(msg.issueRef, msg.workspacePath);
          } catch (err) {
            const text = err instanceof Error ? err.message : "Unknown error";
            vscode.window.showErrorMessage(`Failed to add comment: ${text}`);
          }
        }
        if (msg.command === "editIssue") {
          try {
            await this.client.editIssue(msg.issueRef, msg.fields, msg.workspacePath);
            this.onMutation?.();
            await this.show(msg.issueRef, msg.workspacePath);
          } catch (err) {
            const text = err instanceof Error ? err.message : "Unknown error";
            vscode.window.showErrorMessage(`Failed to edit issue: ${text}`);
          }
        }
        if (msg.command === "setPriority") {
          const pick = await vscode.window.showQuickPick(
            [
              { label: "0 — Highest", value: "0" },
              { label: "1 — High", value: "1" },
              { label: "2 — Medium", value: "2" },
              { label: "3 — Low", value: "3" },
              { label: "4 — Lowest", value: "4" },
              { label: "Clear priority", value: "-" },
            ],
            { placeHolder: "Set priority" }
          );
          if (!pick) return;
          try {
            await this.client.editIssue(msg.issueRef, { priority: pick.value }, msg.workspacePath);
            this.onMutation?.();
            await this.show(msg.issueRef, msg.workspacePath);
          } catch (err) {
            const text = err instanceof Error ? err.message : "Unknown error";
            vscode.window.showErrorMessage(`Failed to set priority: ${text}`);
          }
        }
        if (msg.command === "assign") {
          const owner = await vscode.window.showInputBox({
            prompt: "Assign to",
            placeHolder: "Enter owner name (leave empty to unassign)",
            value: msg.currentOwner ?? "",
          });
          if (owner === undefined) return;
          try {
            if (owner.trim()) {
              await this.client.assignIssue(msg.issueRef, owner.trim(), msg.workspacePath);
            } else {
              await this.client.unassignIssue(msg.issueRef, msg.workspacePath);
            }
            this.onMutation?.();
            await this.show(msg.issueRef, msg.workspacePath);
          } catch (err) {
            const text = err instanceof Error ? err.message : "Unknown error";
            vscode.window.showErrorMessage(`Failed to update owner: ${text}`);
          }
        }
        if (msg.command === "addLabel") {
          try {
            const existing = await this.client.listLabels(msg.workspacePath);
            const currentLabels: string[] = msg.currentLabels ?? [];
            const available = existing.labels
              .map((l) => l.label)
              .filter((l) => !currentLabels.includes(l));
            const items = available.map((l) => ({ label: l }));
            items.unshift({ label: "$(plus) New label..." });
            const pick = await vscode.window.showQuickPick(items, {
              placeHolder: "Select a label to add",
            });
            if (!pick) return;
            let labelName = pick.label;
            if (labelName === "$(plus) New label...") {
              const input = await vscode.window.showInputBox({
                prompt: "New label name",
                placeHolder: "e.g. bug, feature, docs",
              });
              if (!input?.trim()) return;
              labelName = input.trim();
            }
            await this.client.addLabel(msg.issueRef, labelName, msg.workspacePath);
            this.onMutation?.();
            await this.show(msg.issueRef, msg.workspacePath);
          } catch (err) {
            const text = err instanceof Error ? err.message : "Unknown error";
            vscode.window.showErrorMessage(`Failed to add label: ${text}`);
          }
        }
        if (msg.command === "removeLabel") {
          try {
            await this.client.removeLabel(msg.issueRef, msg.label, msg.workspacePath);
            this.onMutation?.();
            await this.show(msg.issueRef, msg.workspacePath);
          } catch (err) {
            const text = err instanceof Error ? err.message : "Unknown error";
            vscode.window.showErrorMessage(`Failed to remove label: ${text}`);
          }
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
    const nonce = crypto.randomBytes(16).toString("base64");

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

    const closeMsg = JSON.stringify({ command: "close", issueRef, workspacePath });
    const reopenMsg = JSON.stringify({ command: "reopen", issueRef, workspacePath });
    const actionButtons =
      issue.status === "open"
        ? `<button class="btn btn-primary" data-msg="${escapeAttr(closeMsg)}">Close</button>`
        : `<button class="btn btn-secondary" data-msg="${escapeAttr(reopenMsg)}">Reopen</button>`;

    const labels = data.labels ?? [];
    const currentLabelNames = labels.map((l) => l.label);
    const addLabelMsg = JSON.stringify({ command: "addLabel", issueRef, workspacePath, currentLabels: currentLabelNames });
    const labelChips = labels.map((l) => {
      const rmMsg = JSON.stringify({ command: "removeLabel", issueRef, workspacePath, label: l.label });
      return `<span class="label">${escapeHtml(l.label)} <a class="label-rm" href="#" data-msg="${escapeAttr(rmMsg)}" title="Remove label">&times;</a></span>`;
    }).join(" ");
    const labelsHtml = `<div class="labels">${labelChips} <button class="btn-icon" data-msg="${escapeAttr(addLabelMsg)}" title="Add label">+ Label</button></div>`;

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
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'">
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
    .body h3 {
      margin: 0 0 8px 0;
      font-size: 0.95em;
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
    .btn-icon {
      background: none;
      border: none;
      cursor: pointer;
      font-size: 0.85em;
      color: var(--vscode-descriptionForeground);
      padding: 2px 4px;
      vertical-align: middle;
    }
    .btn-icon:hover {
      color: var(--vscode-editor-foreground);
    }
    .btn-sm {
      padding: 2px 8px;
      font-size: 0.8em;
    }
    #title-input {
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, var(--vscode-widget-border));
      padding: 4px 8px;
      font-size: 1em;
      font-family: var(--vscode-font-family);
      width: 60%;
      border-radius: 4px;
    }
    #body-input, #comment-input {
      width: 100%;
      box-sizing: border-box;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, var(--vscode-widget-border));
      padding: 8px;
      font-size: var(--vscode-font-size);
      font-family: var(--vscode-font-family);
      border-radius: 4px;
      resize: vertical;
    }
    .editor-actions {
      margin-top: 8px;
      display: flex;
      gap: 8px;
    }
    .add-comment {
      margin-top: 16px;
      padding-top: 16px;
      border-top: 1px solid var(--vscode-widget-border);
    }
    .add-comment h3 {
      margin: 0 0 8px 0;
      font-size: 0.95em;
    }
    .add-comment .btn {
      margin-top: 8px;
    }
    .editable-field {
      color: var(--vscode-textLink-foreground);
      cursor: pointer;
      text-decoration: none;
    }
    .editable-field:hover {
      text-decoration: underline;
    }
    .label-rm {
      color: var(--vscode-descriptionForeground);
      text-decoration: none;
      margin-left: 2px;
      font-weight: bold;
    }
    .label-rm:hover {
      color: var(--vscode-errorForeground);
    }
  </style>
</head>
<body>
  <div class="header">
    <span class="status ${statusClass}">${statusLabel}</span>
    <span class="header-title">
      <span id="title-display">#${issue.number} — ${escapeHtml(issue.title)}</span>
      <button class="btn-icon" id="edit-title-btn" title="Edit title">&#9998;</button>
      <span id="title-editor" style="display:none">
        <input type="text" id="title-input" value="${escapeAttr(issue.title)}" />
        <button class="btn btn-primary btn-sm" id="title-save">Save</button>
        <button class="btn btn-secondary btn-sm" id="title-cancel">Cancel</button>
      </span>
    </span>
    <span class="header-field"><strong>Owner:</strong> <a class="editable-field" id="assign-btn" href="#">${escapeHtml(ownerDisplay)}</a></span>
    <span class="header-field"><strong>Priority:</strong> <a class="editable-field" id="priority-btn" href="#">${priorityDisplay}</a></span>
    <span class="header-field"><strong>Created:</strong> ${relativeTime(issue.created_at)}</span>
  </div>
  ${labelsHtml}
  <div class="actions">
    ${actionButtons}
    <button class="btn btn-secondary" data-msg="${escapeAttr(JSON.stringify({ command: "openTui" }))}">Open TUI</button>
  </div>
  <div class="body">
    <h3>Description <button class="btn-icon" id="edit-body-btn" title="Edit description">&#9998;</button></h3>
    <div id="body-display">${bodyHtml}</div>
    <div id="body-editor" style="display:none">
      <textarea id="body-input" rows="8">${escapeHtml(issue.body ?? "")}</textarea>
      <div class="editor-actions">
        <button class="btn btn-primary btn-sm" id="body-save">Save</button>
        <button class="btn btn-secondary btn-sm" id="body-cancel">Cancel</button>
      </div>
    </div>
  </div>
  ${relationshipsHtml}
  ${commentsHtml}
  <div class="add-comment">
    <h3>Add Comment</h3>
    <textarea id="comment-input" rows="4" placeholder="Write a comment..."></textarea>
    <button class="btn btn-primary" id="comment-submit" disabled>Comment</button>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const issueRef = ${safeJson(issueRef)};
    const workspacePath = ${safeJson(workspacePath)};

    document.addEventListener('click', (e) => {
      const el = e.target.closest('[data-msg]');
      if (!el) return;
      e.preventDefault();
      vscode.postMessage(JSON.parse(el.dataset.msg));
    });

    const commentInput = document.getElementById('comment-input');
    const commentSubmit = document.getElementById('comment-submit');
    commentInput.addEventListener('input', () => {
      commentSubmit.disabled = !commentInput.value.trim();
    });
    commentSubmit.addEventListener('click', () => {
      const body = commentInput.value.trim();
      if (!body) return;
      commentSubmit.disabled = true;
      commentInput.disabled = true;
      vscode.postMessage({ command: 'addComment', issueRef, workspacePath, body });
    });

    const titleDisplay = document.getElementById('title-display');
    const titleEditor = document.getElementById('title-editor');
    const titleInput = document.getElementById('title-input');
    document.getElementById('edit-title-btn').addEventListener('click', () => {
      titleDisplay.style.display = 'none';
      document.getElementById('edit-title-btn').style.display = 'none';
      titleEditor.style.display = 'inline';
      titleInput.focus();
      titleInput.select();
    });
    document.getElementById('title-cancel').addEventListener('click', () => {
      titleEditor.style.display = 'none';
      titleDisplay.style.display = 'inline';
      document.getElementById('edit-title-btn').style.display = 'inline';
      titleInput.value = ${safeJson(issue.title)};
    });
    document.getElementById('title-save').addEventListener('click', () => {
      const title = titleInput.value.trim();
      if (!title) return;
      vscode.postMessage({ command: 'editIssue', issueRef, workspacePath, fields: { title } });
    });
    titleInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('title-save').click();
      if (e.key === 'Escape') document.getElementById('title-cancel').click();
    });

    const bodyDisplay = document.getElementById('body-display');
    const bodyEditor = document.getElementById('body-editor');
    const bodyInput = document.getElementById('body-input');
    document.getElementById('edit-body-btn').addEventListener('click', () => {
      bodyDisplay.style.display = 'none';
      bodyEditor.style.display = 'block';
      bodyInput.focus();
    });
    document.getElementById('body-cancel').addEventListener('click', () => {
      bodyEditor.style.display = 'none';
      bodyDisplay.style.display = 'block';
      bodyInput.value = ${safeJson(issue.body ?? "")};
    });
    document.getElementById('body-save').addEventListener('click', () => {
      vscode.postMessage({ command: 'editIssue', issueRef, workspacePath, fields: { body: bodyInput.value } });
    });

    document.getElementById('priority-btn').addEventListener('click', (e) => {
      e.preventDefault();
      vscode.postMessage({ command: 'setPriority', issueRef, workspacePath });
    });

    document.getElementById('assign-btn').addEventListener('click', (e) => {
      e.preventDefault();
      vscode.postMessage({ command: 'assign', issueRef, workspacePath, currentOwner: ${safeJson(issue.owner ?? "")} });
    });
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
      const parentMsg = JSON.stringify({ command: "showIssue", issueRef: parentRef, workspacePath });
      items.push(
        `<div class="rel-item">
          <span class="rel-type">Parent</span>
          <a class="rel-link" href="#" data-msg="${escapeAttr(parentMsg)}">
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
      const childMsg = JSON.stringify({ command: "showIssue", issueRef: childRef, workspacePath });
      items.push(
        `<div class="rel-item">
          <span class="rel-type">Child</span>
          <a class="rel-link" href="#" data-msg="${escapeAttr(childMsg)}">
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
      const linkMsg = JSON.stringify({ command: "showIssue", issueRef: targetRef, workspacePath });
      items.push(
        `<div class="rel-item">
          <span class="rel-type">${label}</span>
          <a class="rel-link" href="#" data-msg="${escapeAttr(linkMsg)}">
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


function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/[<>\u2028\u2029]/g, (ch) => {
      const code = ch.charCodeAt(0);
      return "\\u" + code.toString(16).padStart(4, "0");
    });
}


function escapeAttr(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
