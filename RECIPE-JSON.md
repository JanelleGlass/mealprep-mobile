# MealPrep recipe JSON

Recipes → **⇪ import from JSON** accepts one recipe as a single JSON object.
The app previews how every ingredient resolves before anything is saved.

To have a chat model write one for you, paste this whole file into the chat
along with the recipe (a URL, a photo transcription, or a description) and ask
for "MealPrep recipe JSON".

## Format

```json
{
  "name": "Blueberry Lemon Pie",
  "servings": 8,
  "category": "Dessert",
  "variationOf": "Lemon Pie Delux",
  "summary": "Graham crust, a thick blueberry layer, tart lemon filling.",
  "ingredients": [
    { "name": "Blueberries", "quantity": 2, "unit": "cup", "nutrition": "BLUEBERRIES,RAW" },
    { "name": "Sugar", "quantity": 157.5, "unit": "g", "nutrition": "SUGARS,GRANULATED" },
    { "name": "Cream Cheese", "quantity": 4, "unit": "oz", "nutrition": "CHEESE,CREAM", "section": "Fridge" }
  ],
  "ingredientLines": [
    "1.5 cups graham cracker crumbs (about 11 full sheets)",
    "3 tablespoons sugar, for the crust"
  ],
  "steps": [
    "Press the crust: heat oven to 350°F…",
    "Bake and cool the crust…"
  ],
  "notes": [
    "Use a deep-dish plate — a standard 9-inch will overflow."
  ]
}
```

## Fields

| field | required | meaning |
|---|---|---|
| `name` | yes | Recipe name. Import is blocked if a recipe with this name already exists. |
| `servings` | yes | How many servings the whole recipe makes (number ≥ 1). |
| `ingredients` | yes | One entry per distinct ingredient — see below. |
| `category` | no | Recipe section: Breakfast, Soup, Salad, Main, Side, Bread, Dessert, Sauce & Dressing, Drink, Snack, Other. Unknown values file under Other. |
| `variationOf` | no | Exact name of an existing recipe to file this under as a variation. Import is blocked if it doesn't exist. |
| `summary` | no | One-paragraph intro; becomes the first line of the description. |
| `ingredientLines` | no | The human-written ingredient list (per-component amounts, "divided", etc.). If omitted, a list is generated from `ingredients` whenever `steps` are present (with neither, the description carries no INGREDIENTS block — the app already lists the rows). |
| `steps` | no | Numbered automatically — don't include "1." prefixes (they're stripped if you do). |
| `notes` | no | Free-form paragraphs appended after the steps. |
| `description` | no | Escape hatch: use this text verbatim instead of assembling summary/INGREDIENTS/STEPS/NOTES. |

### Ingredient entries

| field | required | meaning |
|---|---|---|
| `name` | yes | Matched against existing ingredients by name, case-insensitive. A match is **reused**; no match creates a new ingredient. |
| `quantity` | yes | Amount **in the ingredient's stored unit** (see gotchas). |
| `unit` | for new ingredients | One of: tsp, tbsp, fl oz, cup, pt, qt, gal, ml, L, oz, lb, g, kg, pinch, dash, clove, slice, piece, whole, can, bunch, sprig, head, stalk, to taste. Common long forms ("tablespoons", "ounces") are understood. |
| `nutrition` | recommended for new ingredients | Exact USDA description to link (e.g. `BUTTER,WITH SALT`). No exact match → created unlinked and the recipe shows "not counted" until you link it. |
| `section` | no | Pantry section for a new ingredient: Fridge, Freezer, Produce, Dry Goods, Canned Goods, Baking, Spices & Seasonings, Sauces & Oils, Drinks, Other. |

## Gotchas (the preview flags all of these)

- **An existing ingredient keeps its own unit.** If "Heavy Cream" is stored in
  fl oz, a quantity of 1 means 1 fl oz no matter what `unit` says — convert the
  quantity to the stored unit instead of relying on the unit field.
- **One entry per ingredient.** An ingredient used in several components
  (sugar in the crust *and* the filling) gets one entry with the summed
  quantity; keep the per-component breakdown in `ingredientLines`. Repeated
  names in the same unit are summed automatically with a warning; repeated
  names in *different* units block the import.
- **Duplicate recipe names are blocked**, so a re-import can't double up.
- `quantity` is a plain number — write `0.75`, not `"3/4"`.
