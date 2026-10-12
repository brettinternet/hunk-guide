# Try hunk-guide

Review a station departure board, from one status badge to a live multi-file change.

| Example                                   | What to try                                                 |
| ----------------------------------------- | ----------------------------------------------------------- |
| [1. Status badge](01-status-badge/)       | Old/new lines, section navigation, review progress          |
| [2. Departure board](02-departure-board/) | Multi-target sections, focused hunks, overview              |
| [3. Live review](03-live-review/)         | Section visibility, checkpoints, stale progress, generation |

Run commands from the checkout root. Install dependencies with `task init` first. Use [Hunk with extension API 30](../README.md#building-hunk-main); the published 0.23.0 release cannot load this plugin.

Each example opens an interactive TUI. Patch mode does not change your files. Quit Hunk before starting the next example. If Guide is closed, press `Alt+G`.

The keys below are defaults. Remapped keys appear in Guide; all actions are also in Hunk's **Extensions** menu.

```text
● ON TIME      ▲ +8 MIN      ■ CANCELLED
```

The examples use short code blocks and distinct status symbols. Hunk supplies syntax highlighting and diff colors; Guide stays beside the real diff.
