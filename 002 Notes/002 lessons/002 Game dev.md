---
icon: lucide-gamepad
tags:
  - Type/Main-Files
banner: https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcT7T4t4fPZESjszUwZET91figWM1toOfRorodZrC9JXrg&s=10
cssclasses:
  - Link
  - Disappear
---
```base
filters:
  or:
    - note["The Topic"].contains("Games")
views:
  - type: table
    name: Table
    groupBy:
      property: The Topic
      direction: ASC
    order:
      - file.name
      - file.ctime
      - file.tags

```

> [!link]- Bases Links
> [[Fully Ai Game]]
> [[Noise in the games]]
