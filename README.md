# kata for VS Code

Manage [kata](https://github.com/wesm/kata) issues directly from VS Code. kata is a lightweight, local-first issue tracker designed for developers and AI agents.

<img width="1109" height="745" alt="image" src="https://github.com/user-attachments/assets/fcaaec8c-a0cb-4c18-b82e-ac39e4c16e4e" />

## What You Get

- **Sidebar tree view** -- issues grouped by project and status (open/closed), with badge counts
- **Issue detail panel** -- full issue view with markdown body, comments, relationships, and labels
- **Inline editing** -- edit title, body, owner, priority, and labels without leaving VS Code
- **Comments** -- add comments directly from the detail panel
- **Actions** -- create, close, reopen issues from the tree or detail view
- **TUI access** -- launch the kata terminal UI from the command palette or sidebar

## Requirements

- [kata CLI](https://github.com/wesm/kata) installed and on your PATH
- kata daemon running (`kata daemon start`)
- At least one project initialized (`kata init` in your workspace)

## Commands

| Command | Description |
|---------|-------------|
| `kata: Refresh Issues` | Refresh the issue tree |
| `kata: Create Issue` | Create a new issue |
| `kata: Show Issue` | Open the issue detail panel |
| `kata: Close Issue` | Close an issue with a reason |
| `kata: Reopen Issue` | Reopen a closed issue |
| `kata: Open TUI` | Launch the kata terminal UI |

## Install

**VS Code Marketplace:** Search for "kata" by sarcasticbird.

**From GitHub Releases:** Download the `.vsix` file and run:
```
code --install-extension vscode-kata-0.1.0.vsix
```

## Getting Started

1. Install the kata CLI and start the daemon
2. Run `kata init` in your project directory
3. Open the project in VS Code
4. The kata sidebar appears in the activity bar

The extension auto-discovers kata projects by scanning workspace folders for `.kata.toml` files. Issues refresh automatically when the window is focused, and a background poll keeps the tree up to date.

## Development

```bash
flox activate
npm install
npm run build
# Press F5 in VS Code to launch the Extension Development Host
```

## License

MIT
