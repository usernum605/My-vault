---
ui: preview-force
hidely: true
cssclasses:
  - prop
  - dashboard
  - Link
---

```base
filters:
  or:
    - file.folder == "002 Notes/001 Notes"
    - file.folder == "002 Notes/003 Saved Notes"
    - and:
        - file.hasProperty("The Topic")
        - file.name != "Quick Notes tem"
        - file.folder != "002 Notes/002 Lessons"
        - file.name != "Sync"
        - '!file.name.contains("Tem")'
views:
  - type: table
    name: Table
    groupBy:
      property: The Topic
      direction: ASC
    order:
      - file.name
      - file.links
      - file.tags
    sort: []
    summaries: {}
    rowHeight: medium
    markers: bullet
    columnSize:
      file.links: 199

```

> [!link]- Real Links (Base)
> - [[002 Notes/001 Notes/Poem.md|Poem]]
> - [[002 Notes/001 Notes/Quran.md|Quran]]
> - [[002 Notes/001 Notes/Rebuild icons.md|Rebuild icons]]
> - [[002 Notes/002 Lessons/Logs/log - 2026-02-27.md|log - 2026-02-27]]
> - [[002 Notes/002 Lessons/Logs/log - 2026-02-28.md|log - 2026-02-28]]
> - [[002 Notes/002 Lessons/Logs/log - 2026-03-01.md|log - 2026-03-01]]
> - [[002 Notes/003 Saved Notes/Interesting topic.md|Interesting topic]]
> - [[002 Notes/003 Saved Notes/Log - How to learn.md|Log - How to learn]]
> - [[002 Notes/003 Saved Notes/Mawaidh.md|Mawaidh]]
> - [[002 Notes/003 Saved Notes/Messages/كيف نستثمر اوقاتنا.md|كيف نستثمر اوقاتنا]]
> - [[002 Notes/003 Saved Notes/My YouTube Channels.md|My YouTube Channels]]
> - [[002 Notes/003 Saved Notes/Tathakar.md|Tathakar]]
> - [[002 Notes/003 Saved Notes/سلسلة أحداث يوم الحساب.md|سلسلة أحداث يوم الحساب]]
> - [[002 Notes/003 Saved Notes/سلسلة الموت.md|سلسلة الموت]]
> - [[002 Notes/004 Archived Notes/Fully Ai Game.md|Fully Ai Game]]
> - [[002 Notes/004 Archived Notes/Prompt.md|Prompt]]
> - [[004 Files/002 Archive/Olds/Old Topics/Termux commands Ai.md|Termux commands Ai]]
> - [[004 Files/002 Archive/Olds/Old Topics/Termux commands Pomo.md|Termux commands Pomo]]
> - [[004 Files/003 AI Conversations/To Learn.md|To Learn]]




















