---
ui: preview-force
links pages:
  - " path: 002 Notes"
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
        - file.name != "Tem"
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


























































---
<!-- Auto-generated folder links -->
[[Quran]] [[Rebuild icons]] [[000 Map of content]] [[001 The Courses]] [[002 Game dev]] [[003 Math]] [[Ai course]] [[log - 2026-02-26]] [[log - 2026-02-27]] [[log - 2026-02-28]] [[Noise in the games]] [[الدوال]] [[Interesting topic]] [[Log - How to learn]] [[Mawaidh]] [[My YouTube Channels]] [[Tathakar]] [[سلسلة أحداث يوم الحساب]] [[سلسلة الموت]] [[كيف نستثمر اوقاتنا]] [[Fully Ai Game]] [[Learn]] [[Prompt]] [[alone]]