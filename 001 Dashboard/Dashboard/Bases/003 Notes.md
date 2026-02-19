---
links pages:
  - "[[002 My projects]]"
  - " path: 002 Notes"
---
```base
filters:
  and:
    - file.inFolder("002 Notes/001 Notes")
views:
  - type: cards
    name: Table
    order:
      - file.name
    sort: []
    cardSize: 220
    image: note.banner
    imageAspectRatio: 0.45

```