---
ui: preview-force
---

```base
filters:
  and:
    - file.folder == "002 Notes/001 Notes"
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
      file.name: 165
      file.links: 203
      file.tags: 263
    rowHeight: medium

```