In Python, **lists are mutable**, while **tuples are immutable**:

- **List:** You can add, remove, or replace items. Uses square brackets: `[1, 2, 3]`.
- **Tuple:** You cannot add, remove, or replace items after creation. Usually written with parentheses: `(1, 2, 3)`.

```python
numbers = [1, 2, 3]
numbers[0] = 10      # Works
numbers.append(4)   # Works

point = (1, 2, 3)
point[0] = 10       # Raises TypeError
```

Both preserve order, allow duplicates, and support indexing and slicing.

Use a **list** for a collection that may change, such as a shopping list. Use a **tuple** for a fixed grouping, such as coordinates `(x, y)`.

Two details:

- A one-item tuple needs a trailing comma: `(42,)`.
- A tuple can contain mutable objects, such as lists; those objects can still change.
