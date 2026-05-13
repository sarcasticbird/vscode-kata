import * as vscode from "vscode";
import * as path from "node:path";
import * as fs from "node:fs";
import { KataClient } from "./kata-client.js";
import { IssueTreeProvider } from "./issue-tree.js";
import { IssueWebviewManager, collectEvidence } from "./issue-webview.js";

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
  let projectPaths =
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
    projectPaths =
      folders && folders.length > 0
        ? discoverProjects(folders, outputChannel)
        : [];
    treeProvider.updateProjectPaths(projectPaths);
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

  const refreshTree = async () => {
    await treeProvider.refresh();
    updateBadge();
  };

  const webviewManager = new IssueWebviewManager(
    client,
    outputChannel,
    async (action, issueRef, workspacePath, reason, message, evidence) => {
      if (action === "close" && reason && message) {
        await client.closeIssue(issueRef, reason, message, workspacePath, evidence);
      } else if (action === "reopen") {
        await client.reopenIssue(issueRef, workspacePath);
      }
      await refreshTree();
    },
    () => { refreshTree(); }
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
      async (item: { issueRef?: string; workspacePath?: string }) => {
        if (item.issueRef && item.workspacePath) {
          const reason = await vscode.window.showQuickPick(
            ["done", "wontfix", "duplicate"],
            { placeHolder: "Select close reason" }
          );
          if (!reason) return;
          const minLen = reason === "wontfix" ? 60 : 40;
          const message = await vscode.window.showInputBox({
            prompt: `Close message (${minLen}+ chars required)`,
            placeHolder: reason === "wontfix"
              ? "Explain why this won't be fixed"
              : "Describe what was done and how it was verified",
            validateInput: (val) =>
              val.trim().length < minLen
                ? `Message must be at least ${minLen} characters (currently ${val.trim().length})`
                : null,
          });
          if (!message) return;
          const evidence = reason === "done"
            ? await collectEvidence(item.workspacePath)
            : undefined;
          if (reason === "done" && !evidence) return;
          try {
            await client.closeIssue(
              item.issueRef,
              reason,
              message,
              item.workspacePath,
              evidence
            );
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Unknown error";
            vscode.window.showErrorMessage(`Failed to close issue: ${msg}`);
            return;
          }
          await treeProvider.refresh();
          updateBadge();
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "kata.reopen",
      async (item: { issueRef?: string; workspacePath?: string }) => {
        if (item.issueRef && item.workspacePath) {
          await client.reopenIssue(
            item.issueRef,
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
          response.issue.short_id,
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
