---
ui: preview-force
cssclasses:
  - dashboard
  - Disappear
  - list-cards
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
        - file.folder != "002 Notes/002 Lessons/Logs"
        - file.folder != "004 Files/002 Archive/002 Interesting"
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
> - [[Quran]]
> - [[Rebuild icons]]
> - [[Interesting topic]]
> - [[Log - How to learn]]
> - [[Mawaidh]]
> - [[كيف نستثمر اوقاتنا]]
> - [[My YouTube Channels]]
> - [[Poem]]
> - [[Quotes]]
> - [[Tathakar]]
> - [[سلسلة أحداث يوم الحساب]]
> - [[سلسلة الموت]]
> - [[Fully Ai Game]]
> - [[Prompt]]
> - [[Termux commands Ai]]
> - [[Termux commands Pomo]]
> - [[How]]
> - [[Server]]
> - [[To Learn]]
> - [[Var vs Let]]

