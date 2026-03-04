---
ui: preview-force
cssclasses:
  - dashboard
  - Link
  - Disappear
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
> - [[Quran]]
> - [[Rebuild icons]]
> - [[log - 2026-02-27]]
> - [[log - 2026-02-28]]
> - [[log - 2026-03-01]]
> - [[log - 2026-03-02]]
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
> - [[To Learn]]


























































































































































































