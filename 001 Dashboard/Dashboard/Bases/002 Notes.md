---
links pages:
  - "[[005 My projects]]"
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
    cardSize: 320
    image: note.banner
    imageAspectRatio: 0.45
```