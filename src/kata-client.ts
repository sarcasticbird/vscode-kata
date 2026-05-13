import { execFile } from "node:child_process";
import * as vscode from "vscode";
import type {
  KataListResponse,
  KataShowResponse,
  KataEventsResponse,
  KataHealthResponse,
  KataCreateResponse,
  KataLabelsResponse,
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

  async addComment(
    issueRef: string,
    body: string,
    workspacePath: string
  ): Promise<void> {
    await this.exec([
      "comment",
      issueRef,
      "--body", body,
      "--json",
      "--workspace", workspacePath,
    ], { timeout: 10_000 });
  }

  async editIssue(
    issueRef: string,
    fields: { title?: string; body?: string; priority?: string },
    workspacePath: string
  ): Promise<void> {
    const args = ["edit", issueRef, "--json", "--workspace", workspacePath];
    if (fields.title !== undefined) {
      args.push("--title", fields.title);
    }
    if (fields.body !== undefined) {
      args.push("--body", fields.body);
    }
    if (fields.priority !== undefined) {
      args.push("--priority", fields.priority);
    }
    await this.exec(args, { timeout: 10_000 });
  }

  async assignIssue(
    issueRef: string,
    owner: string,
    workspacePath: string
  ): Promise<void> {
    await this.exec([
      "assign", issueRef, owner,
      "--json", "--workspace", workspacePath,
    ], { timeout: 10_000 });
  }

  async unassignIssue(
    issueRef: string,
    workspacePath: string
  ): Promise<void> {
    await this.exec([
      "unassign", issueRef,
      "--json", "--workspace", workspacePath,
    ], { timeout: 10_000 });
  }

  async addLabel(
    issueRef: string,
    label: string,
    workspacePath: string
  ): Promise<void> {
    await this.exec([
      "label", "add", issueRef, label,
      "--json", "--workspace", workspacePath,
    ], { timeout: 10_000 });
  }

  async removeLabel(
    issueRef: string,
    label: string,
    workspacePath: string
  ): Promise<void> {
    await this.exec([
      "label", "rm", issueRef, label,
      "--json", "--workspace", workspacePath,
    ], { timeout: 10_000 });
  }

  async listLabels(workspacePath: string): Promise<KataLabelsResponse> {
    const output = await this.exec([
      "labels", "--json", "--workspace", workspacePath,
    ]);
    return JSON.parse(output) as KataLabelsResponse;
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
      const redacted = args.map((a, i) =>
        i > 0 && ["--body", "--title"].includes(args[i - 1]) ? "[redacted]" : a
      );
      this.outputChannel.appendLine(`${binary} ${redacted.join(" ")}`);

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
