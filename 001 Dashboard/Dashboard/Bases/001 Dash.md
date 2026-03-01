---
links pages:
  - "path: 001 Dashboard"
  - "[[Dashboard]]"
---

```base
filters:
  and:
    - file.inFolder("001 Dashboard")
    - not:
        - file.inFolder("001 Dashboard/Dashboard/Bases")
views:
  - type: cards
    name: Table
    imageAspectRatio: 0.45
    image: note.banner
    cardSize: 210
```
