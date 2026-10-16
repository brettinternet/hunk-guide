# Try hunk-guide

Review a station departure board, from one status badge to a change you guide yourself.

| Example                                           | What to try                                              |
| ------------------------------------------------- | -------------------------------------------------------- |
| [1. Status badge](01-status-badge/)               | Old/new lines, section navigation, review progress       |
| [2. Departure board](02-departure-board/)         | Multi-target sections, focused hunks, overview           |
| [3. Live review](03-live-review/)                 | Section visibility, checkpoints, stale progress, reloads |
| [4. Guide your own change](04-guide-your-change/) | Agent-written guides, generation in Hunk, target checks  |

Run commands from the checkout root. Install dependencies with `task init` first. Use [Hunk with extension API 30](../README.md#building-hunk-main); the published 0.23.0 release cannot load this plugin. Example 4 also needs a coding-agent CLI.

Each example opens an interactive TUI. Patch mode and the sandboxes in examples 3 and 4 leave your checkout unchanged. Quit Hunk before starting the next example. If Guide is closed, press `Alt+G`.

The keys below are defaults. Remapped keys appear in Guide; all actions are also in Hunk's **Extensions** menu.

```text
● ON TIME      ▲ +8 MIN      ■ CANCELLED      ◆ PLATFORM 4
```

The examples use short code blocks and distinct status symbols. Hunk supplies syntax highlighting and diff colors; Guide stays beside the real diff.
