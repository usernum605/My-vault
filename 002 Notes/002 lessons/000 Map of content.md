---
icon: lucide-map-pinned
links pages:
  - "[[Dashboard]]"
banner: https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRzIg8KgmlGtYJif9lbh_0hyVN8k3wwcdHshBWK5mj6bw&s=10
cssclasses:
  - invert-banner
  - invert-dark
  - Headless
  - list-cards
  - cards-cols-2
node_size: 20
---
##### Main Files
```base
filters:
  and:
    - file.inFolder("002 Notes/002 Lessons")
    - file.hasTag("Type/Main-Files")
views:
  - type: table
    name: Table
    order:
      - file.name

```

> [!link]- Real Links (Base)
> - [[001 The Courses]]
> - [[002 Game dev]]
> - [[003 Math]]

