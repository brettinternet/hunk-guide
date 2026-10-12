# 2. Departure board

Follow the data, then the display, then the test. Guide order differs from file order.

```text
09:41  Harbor        P2  ● ON TIME
09:48  Pine Ridge    P5  ▲ +8 MIN
```

From the checkout root, after [setup](../README.md),

```sh
HUNK_GUIDE_FILE=examples/02-departure-board/guide.json \
  hunk patch examples/02-departure-board/review.patch --extension .
```

1. In **Define the departures**, press `Alt+L` to move from the type to the sample data in the same file.
2. Press `Alt+J` for **Build one readable row**. Use `Alt+L/H` to move between the status helper and board renderer. Both files belong to one section.
3. Press `Alt+Shift+R` to mark the whole section reviewed.
4. Press `Alt+A` for **Show all changes**, then navigate again. The full diff stays visible until you toggle focus back.
5. Press `Alt+O` for the overview. Use **Guide: toggle verification sections** in **Extensions** to hide or show the test section.

[Next: Live review](../03-live-review/)
