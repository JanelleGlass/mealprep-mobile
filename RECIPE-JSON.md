# MealPrep recipe JSON

Recipes → **⇪ import from JSON** accepts one recipe as a single JSON object.
The app previews how every ingredient resolves before anything is saved.

**To have Claude write one:** paste this whole file into a chat, then paste the
recipe (a link, a photo, or typed-out text). Nothing here needs editing first —
the next section is addressed to Claude, not to you. It works much better if you
also paste your ingredient list: **Pantry → Ingredients → ⧉ copy list**.

---

## Instructions for Claude

You are converting a recipe into MealPrep import JSON. Match the format below
exactly, then output **one fenced `json` block containing a single object**. Put
everything else — what you matched, what you assumed — in prose outside the
fence, so the block can be copied straight into the app on a phone.

### First settle the ingredient list

A quantity is stored in the ingredient's **own** unit, so if "Heavy Cream" is
stored in `fl oz`, a quantity of `1` means 1 fl oz however you label it. This is
the one thing you cannot work out for yourself, and getting it wrong silently
changes the amount.

If the user pasted their list, it looks like `Name (unit), Name (unit), …`.
**Read the LAST parenthetical as the unit** — names contain their own
parentheses more often than not, so `Cheese (Shredded) (oz)` is the ingredient
`Cheese (Shredded)` in `oz`, and `Broccoli (Frozen) 32oz (whole)` is
`Broccoli (Frozen) 32oz` in `whole`. Getting this split wrong invents a
duplicate ingredient. Then:

- Reuse those **exact names** and **convert each quantity into the unit listed
  there**. Do the arithmetic — don't just relabel the unit field.
- **Sanity-check the list.** The chip copies what is on screen, so if the
  "⚠ N not linked" filter was on, you have a small subset rather than the whole
  pantry. If it looks short, or everyday staples like salt or butter are
  missing, say so and ask before treating them as new.
- If the user pasted nothing, ask once. If they would rather skip it, go ahead,
  but list plainly which ingredients you assumed already exist and which you
  treated as new, so they can check that against the preview.

### Three things block the import outright

The preview's import button is disabled — not merely warned — for exactly these:

1. **A recipe `name` that already exists.** Check the name is new.
2. **A `variationOf` that doesn't resolve** to an existing recipe name.
3. **A new ingredient whose `unit` is not in the list below.** This is the one
   fully in your hands: the unit list is a hard whitelist for ingredients that
   don't already exist, so `sheet`, `packet`, `stick` and `handful` all block.
   Pick the nearest listed unit and convert.

Everything else — an unmatched USDA description, a mismatched unit on an
ingredient that already exists — is a warning the user can read and accept.

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
    { "name": "Sugar", "quantity": 150, "unit": "g", "nutrition": "SUGARS,GRANULATED" },
    { "name": "Cream Cheese", "quantity": 4, "unit": "oz", "nutrition": "CHEESE,CREAM", "section": "Fridge" }
  ],
  "ingredientLines": [
    "2 cups blueberries, fresh or frozen",
    "1/2 cup sugar, for the blueberry layer",
    "1/4 cup sugar, for the filling",
    "4 oz cream cheese, at room temperature"
  ],
  "steps": [
    "Cook the blueberry layer until thick and glossy, then cool it completely.",
    "Beat the cream cheese smooth before folding anything into it."
  ],
  "notes": [
    "Use a deep-dish plate — a standard 9-inch will overflow."
  ]
}
```

Note how sugar appears **once** in `ingredients` with the summed weight, and
**twice** in `ingredientLines` with its per-component amounts. That is the
intended shape.

## Fields

| field | required | meaning |
|---|---|---|
| `name` | yes | Recipe name. **Blocks the import** if a recipe with this name already exists. |
| `servings` | yes | How many servings **the whole recipe** makes (number ≥ 1), not a per-person figure. |
| `ingredients` | yes | One entry per distinct ingredient — see below. |
| `category` | no | Recipe section: Breakfast, Soup, Salad, Main, Side, Bread, Dessert, Sauce & Dressing, Drink, Snack, Other. Unknown values file under Other. |
| `variationOf` | no | Exact name of an existing recipe to file this under as a variation. Only set it if the recipe really is one. **Blocks the import** if the name doesn't resolve; naming a variation files under its base, since the tree is one level deep. |
| `summary` | no | One-paragraph intro; becomes the first line of the description. |
| `ingredientLines` | no | The human-written ingredient list (per-component amounts, "divided", etc.). **It replaces the generated list verbatim, so it must account for every ingredient** — anything you leave out is missing from the written recipe. If omitted, a list is generated from `ingredients` whenever `steps` are present (with neither, the description carries no INGREDIENTS block — the app already lists the rows). |
| `steps` | no | Numbered automatically — don't include "1." prefixes (they're stripped if you do). |
| `notes` | no | Free-form paragraphs appended after the steps. |
| `description` | no | Escape hatch: use this text verbatim instead of assembling summary/INGREDIENTS/STEPS/NOTES. |

### Ingredient entries

| field | required | meaning |
|---|---|---|
| `name` | yes | Matched against existing ingredients by name, case-insensitive. A match is **reused**; no match creates a new ingredient. |
| `quantity` | yes | Amount **in the ingredient's stored unit** (see gotchas). A plain number — `0.75`, never `"3/4"` — and it must be **greater than 0**. Zero is a hard error that rejects the whole document, so for "salt to taste" write a small realistic amount like `0.5` tsp. |
| `unit` | for new ingredients | One of: tsp, tbsp, fl oz, cup, pt, qt, gal, ml, L, oz, lb, g, kg, pinch, dash, clove, slice, piece, whole, can, bunch, sprig, head, stalk, to taste. Long forms ("tablespoons", "ounces") are understood, but anything outside this list blocks the import for a new ingredient. `pinch`, `dash` and `to taste` count as zero nutrition — and like every unit, they only apply to an ingredient being created; an existing one keeps its stored unit. |
| `nutrition` | for new ingredients, when you are confident | Exact USDA description to link — see below. |
| `section` | no | Pantry section for a new ingredient: Fridge, Freezer, Produce, Dry Goods, Canned Goods, Baking, Spices & Seasonings, Sauces & Oils, Drinks, Other. |

### USDA nutrition descriptions

`nutrition` has to match a USDA description **exactly** (case-insensitively) to
link. They are SR-style: caps, comma-separated, heavily abbreviated —
`BUTTER,WITH SALT`, `CHEESE,CREAM`, `BLUEBERRIES,RAW`, `SUGARS,GRANULATED`.

**Only supply it when you are confident the description names the same food.** A
guess that matches nothing is harmless: the ingredient is created unlinked, the
preview flags it, and it gets linked in the app with the built-in USDA search. A
guess that matches a *real but different* food is worse than leaving the field
out — it links silently, with no warning, and the recipe then carries the wrong
calories forever. So for unsalted butter do not reach for `BUTTER,WITH SALT`,
and for Neufchâtel do not reach for `CHEESE,CREAM`; leave `nutrition` out and
let the user pick. Don't invent elaborate strings like
`PINEAPPLE JUC,CND,NOT FROM CONC,UNSWTND,W/ ADDED ASCORBIC ACID` either — the
odds of reproducing one verbatim are poor.

## Gotchas (the preview flags all of these)

- **An existing ingredient keeps its own unit.** If "Heavy Cream" is stored in
  fl oz, a quantity of 1 means 1 fl oz no matter what `unit` says — convert the
  quantity to the stored unit instead of relying on the unit field.
- **One entry per ingredient.** An ingredient used in several components
  (sugar in the crust *and* the filling) gets one entry with the summed
  quantity; keep the per-component breakdown in `ingredientLines`. Repeated
  names in the same unit are summed automatically with a warning; repeated
  names in *different* units block the import.
- **A new ingredient needs a unit from the list above**, or the import is
  blocked until the JSON is edited.
- **Duplicate recipe names are blocked**, so a re-import can't double up.

---

*The unit and category lists above mirror `COOKING_UNITS`, `RECIPE_CATEGORIES`
and `PANTRY_CATEGORIES` in `js/ui/common.js`. If they ever disagree, the code is
right and this file needs updating. Claude Code sessions in this repo get the
same guidance automatically from `.claude/skills/recipe-json/`.*
