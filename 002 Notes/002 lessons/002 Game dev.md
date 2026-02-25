---
icon: lucide-gamepad
tags:
  - Type/Main-Files
banner: https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcT7T4t4fPZESjszUwZET91figWM1toOfRorodZrC9JXrg&s=10
hidely: true
---
```base
filters:
  or:
    - note["The Topic"] == ["Game Dev"]
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