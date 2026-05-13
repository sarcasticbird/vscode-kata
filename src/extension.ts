import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel("kata");
  outputChannel.appendLine("kata extension activated");
  context.subscriptions.push(outputChannel);
}

export function deactivate(): void {}
