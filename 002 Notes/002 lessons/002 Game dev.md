---
icon: lucide-gamepad
tags:
  - Type/Main-Files
banner: https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcT7T4t4fPZESjszUwZET91figWM1toOfRorodZrC9JXrg&s=10
cssclasses:
  - Disappear
  - cards-cols-2
  - list-cards
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

> [!link]- Real Links (Base)
> - [[Noise in the games]]
> - [[Fully Ai Game]]

