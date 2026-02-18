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
      file.name: 140
      file.links: 140
      file.tags: 210
    rowHeight: medium

```