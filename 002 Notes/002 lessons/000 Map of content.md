---
icon: lucide-map-pinned
links pages:
  - " path: 002 Notes/002 Lessons"
  - "[[Dashboard]]"
banner: https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRzIg8KgmlGtYJif9lbh_0hyVN8k3wwcdHshBWK5mj6bw&s=10
cssclasses:
  - invert-banner
  - invert-dark
node_size: 20
---
```base
filters:
  and:
    - file.inFolder("002 Notes/002 Lessons")
    - file.hasTag("Type/Main-Files")
views:
  - type: table
    name: Table

```