---
name: recipe-json
description: Convert a recipe into MealPrep import JSON for the Recipes tab's "import from JSON" sheet. Use when asked to turn a recipe (a URL, a photo, a description, or pasted text) into recipe JSON, or when asked what format the importer accepts.
---

# MealPrep recipe JSON

Produce **one** recipe as a single JSON object for Recipes → **⇪ import from JSON**.

## Read these first — they are the ground truth

Paths are relative to the repo root.

- `RECIPE-JSON.md` — the field-by-field format. Follow it exactly.
- `js/ui/common.js` — `COOKING_UNITS`, `RECIPE_CATEGORIES`, `PANTRY_CATEGORIES`.
  Read the real arrays rather than trusting a list quoted elsewhere; if they
  ever disagree with `RECIPE-JSON.md`, the code wins and the doc needs fixing.
- `js/recipeimport.js` — parsing, merging, and what errors versus warns.
- `js/ui/recipes.js` — `openImportSheet`, where the *blocking* rules live.

## Establish the ingredient list before writing any JSON

This is the step that decides whether the import is correct. A quantity is
stored **in the ingredient's own unit**, so if "Heavy Cream" is stored in
`fl oz`, a quantity of `1` means 1 fl oz no matter what `unit` you write.

**Ask the user for Pantry → Ingredients → ⧉ copy list.** It yields
`Name (unit), Name (unit), …` and is the only live, complete source.

- **Read the LAST parenthetical as the unit.** Names routinely contain their
  own parentheses: `Cheese (Shredded) (oz)` is `Cheese (Shredded)` in `oz`;
  `Broccoli (Frozen) 32oz (whole)` is `Broccoli (Frozen) 32oz` in `whole`.
  Splitting on the first parenthesis invents duplicate ingredients.
- **It may be a subset.** The chip copies what is on screen, so with the
  "⚠ N not linked" filter active it copies only those. If the list looks short
  or is missing obvious staples, say so and ask rather than assuming.

If the user can't supply it, there is no reliable substitute in the repo — say
so plainly rather than guessing silently. The two partial sources both mislead:

- `migration-out/` is **gitignored and absent from any fresh clone, worktree or
  cloud session** (see `MIGRATION.md`). Where it does exist locally,
  `003_core.sql` is a full snapshot of the ingredients table at generation time,
  not a seed.
- The tracked `add-recipes-*.sql` files name ingredients via
  `mp_ing('Name', 'unit', 'USDA DESC')`, but **`mp_ing` discards that unit
  whenever the ingredient already exists** — so those units are precisely the
  ones that were wrong before, and cannot be trusted for any existing name.
  They are evidence a name exists, not evidence of its unit.

Then, for every ingredient: reuse the **exact existing name** when one matches
(matching is case-insensitive), and **convert the quantity into that
ingredient's stored unit** — do the arithmetic, don't just relabel the unit
field. For a genuinely new ingredient, pick a `unit` from `COOKING_UNITS`.

Alongside the JSON, say which ingredients you matched and which will be created
new. The preview shows this too, but flagging it up front is what catches a bad
match before the user taps import.

## Three things block the import

The import button is disabled — not merely warned — for exactly these:

1. A recipe `name` that already exists.
2. A `variationOf` that doesn't resolve to an existing recipe.
3. A new ingredient whose `unit` is outside `COOKING_UNITS` (`sheet`, `packet`,
   `stick`, `handful` all block). This is the one wholly in your control.

## USDA nutrition descriptions

`nutrition` must match a USDA description **exactly** (case-insensitively) to
link. They are SR-style: caps, comma-separated, abbreviated —
`BUTTER,WITH SALT`, `CHEESE,CREAM`, `BLUEBERRIES,RAW`, `SUGARS,GRANULATED`.

**Supply it only when confident the description names the same food.** A guess
that matches nothing is harmless — the ingredient is created unlinked and the
preview flags it. A guess that matches a *real but different* food is worse
than omitting the field: it links silently, with no warning, and the recipe
carries the wrong calories from then on. Unsalted butter is not
`BUTTER,WITH SALT`; Neufchâtel is not `CHEESE,CREAM`. When unsure, leave it out
and let the user link it with the app's USDA search.

## Output

One fenced `json` block containing a single object. Caveats go in prose outside
the fence, so the block can be copied straight into the sheet on a phone.

## Before you hand it over

- `servings` is what the **whole recipe** yields, not a per-person number.
- Every `quantity` must be **greater than 0** — zero is a hard error that
  rejects the whole document. For "salt to taste", write a small realistic
  amount rather than 0.
- One entry per ingredient: sum an ingredient used in several components and
  keep the per-component amounts in `ingredientLines`. Repeated names in the
  same unit are summed with a warning; in different units they block.
- If you supply `ingredientLines` it **replaces** the generated list verbatim,
  so it must account for every ingredient — anything omitted is missing from
  the written recipe.
- `quantity` is a plain number — `0.75`, never `"3/4"`.
- `steps` carry no `"1."` prefixes; numbering is added on import.
- Only set `variationOf` if the user said it is a variation.
