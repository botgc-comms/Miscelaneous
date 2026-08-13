# Trophy Cabinet Demo

Each trophy has an image and a JSON metadata file in:

`wwwroot/images/trophies`

Example:

```json
{
  "name": "Wragg Cup",
  "imageFile": "wragg-cup.png",
  "relativeHeight": 8,
  "cellSpan": 1
}
```

`relativeHeight` must be between 1 and 10.

`cellSpan` must be either:

- `1`: occupies one half of a shelf
- `2`: occupies the entire shelf

The cabinet layout is built from the metadata automatically.

Run with:

```powershell
dotnet run
```
