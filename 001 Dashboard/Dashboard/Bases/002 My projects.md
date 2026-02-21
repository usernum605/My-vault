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
        - file.folder != "002 Notes/002 lessons"
        - file.name != "Sync"
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
    columnSize:
      file.name: 140
      file.links: 140
      file.tags: 210
    rowHeight: medium
    markers: bullet

```