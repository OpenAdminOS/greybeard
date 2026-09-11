A **list** is mutable: you can add, remove, or replace its items. A **tuple** is immutable: its items cannot be added, removed, or replaced after creation.

```python
# List: square brackets
colors = ["red", "blue"]
colors[0] = "green"
colors.append("yellow")

# Tuple: parentheses
point = (10, 20)
# point[0] = 30  # Raises TypeError
```

Both are ordered, allow duplicates, and support indexing and slicing.

Use a list for a collection that may change, such as a shopping list. Use a tuple for a fixed grouping, such as coordinates.

Two useful details:

- A one-item tuple needs a comma: `(10,)`.
- A tuple can contain mutable objects, such as lists; those objects can still change.
