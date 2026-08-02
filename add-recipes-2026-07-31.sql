-- Adds 1 recipe: Crock Pot Tomato Basil Bisque.
-- Paste the whole file into the Supabase SQL Editor and Run.
-- Safe to re-run: existing ingredients are reused by name, the recipe is
-- skipped if one with the same name already exists.

-- Helper: find an ingredient by name, or create it linked to a USDA
-- nutrition row (matched by description). Lives in pg_temp, so it
-- disappears when this editor session ends.
create or replace function pg_temp.mp_ing(p_name text, p_unit text, p_nutr_desc text)
returns int language plpgsql as $fn$
declare v_id int;
begin
  select id into v_id from ingredients where lower(name) = lower(p_name) order by id limit 1;
  if v_id is null then
    insert into ingredients (name, unit, nutrition_id)
    values (p_name, p_unit,
      case when p_nutr_desc is null then null
           else (select id from nutritions where description = p_nutr_desc order by id limit 1) end)
    returning id into v_id;
  end if;
  return v_id;
end $fn$;

do $body$
declare v_r int;
begin

  ----------------------------------------------------------------------
  -- Crock Pot Tomato Basil Bisque
  ----------------------------------------------------------------------
  if exists (select 1 from recipes where name = 'Crock Pot Tomato Basil Bisque') then
    raise notice 'Crock Pot Tomato Basil Bisque already exists — skipped';
  else
    insert into recipes (name, description, servings) values
    ('Crock Pot Tomato Basil Bisque', 'Five minutes of stovetop work, then walk away. The bloom step is the one thing worth not skipping — everything after it is dump-and-wait. ~12 servings.

INGREDIENTS
84 grams extra virgin olive oil
450 grams yellow onion, diced
180 grams carrot, coarsely grated
12 garlic cloves, minced
144 grams tomato paste
3 teaspoons dried basil
1.5 teaspoons smoked paprika
0.8 teaspoons crushed red pepper
2460 grams canned diced or crushed tomatoes, undrained
6 teaspoons Better Than Bouillon vegetable base
900 milliliters water
3 teaspoons granulated sugar
60 grams fresh basil leaves, packed
1062 grams evaporated milk (1 can, unsweetened)
3 teaspoons balsamic glaze
3 teaspoons salt
1.5 teaspoons black pepper

STEPS
1. Brown the aromatics: Heat 84 grams extra virgin olive oil in a skillet over medium-high. Add 450 grams yellow onion, diced and 180 grams carrot, coarsely grated, cook until softened and lightly browned at the edges.
2. Bloom the paste: Add 12 garlic cloves, minced, 144 grams tomato paste, 3 teaspoons dried basil, 1.5 teaspoons smoked paprika, and 0.8 teaspoons crushed red pepper. Stir constantly until the paste darkens to brick red and smells toasty. Scrape everything into the crock pot.
3. Slow cook: Add 2460 grams canned diced or crushed tomatoes, undrained, 6 teaspoons Better Than Bouillon vegetable base, 900 milliliters water, and 3 teaspoons granulated sugar to the crock. Stir, cover, cook on LOW 6 hours (or HIGH 3 hours). Nothing needs stirring in between.
4. Blend with fresh basil: Turn the cooker off. Add 60 grams fresh basil leaves, packed and blend smooth with an immersion blender right in the crock. Off-heat basil keeps the color and aroma bright.
5. Finish with milk and glaze: Stir in 1062 grams evaporated milk (1 can, unsweetened) and let it warm through on LOW — don''t let it boil. Finish with 3 teaspoons balsamic glaze, then season with 3 teaspoons salt and 1.5 teaspoons black pepper. Taste and adjust: flat means salt, sharp means more milk.

NOTES
Why the 5-minute stovetop start: a slow cooker never gets hot enough to caramelize tomato paste or brown an onion. Skipping it gives you a thinner, more "canned" flavor. If you truly want zero-pan, dump everything in raw but bump the paste to 65 g and the smoked paprika to 1 tsp to compensate — it''ll be good, just not as deep.

Aroma cooker: if yours has a sauté or quick-cook setting, do steps 1–2 right in the pot and skip the extra pan entirely.

Water is reduced from the stovetop version (300 ml vs 480 ml) because slow cookers barely evaporate. If it''s thicker than you want at the end, thin with water or extra milk.

Never add the dairy early. Six hours of acidic tomato will curdle it. It goes in at the very end, off or on low.

Protein boost: blend 200 g cottage cheese in at step 4 alongside the basil.

Parmesan rind: if you have one, toss it in at step 3 and fish it out before blending. Free umami.', 12)
    returning id into v_r;

    insert into recipe_ingredients (recipe_id, ingredient_id, quantity) values
    (v_r, pg_temp.mp_ing('Olive Oil', 'fl oz', 'OIL,OLIVE,SALAD OR COOKING'), 3.1),                            -- 84 g
    (v_r, pg_temp.mp_ing('Onions', 'whole', 'ONIONS,RAW'), 4),                                                 -- 450 g diced
    (v_r, pg_temp.mp_ing('Carrot', 'g', 'CARROTS,RAW'), 180),
    (v_r, pg_temp.mp_ing('Garlic', 'clove', 'GARLIC,RAW'), 12),
    (v_r, pg_temp.mp_ing('Tomato Paste', 'g', 'TOMATO PRODUCTS,CND,PASTE,WO/ SALT ADDED'), 144),
    (v_r, pg_temp.mp_ing('Dried Basil', 'tsp', 'SPICES,BASIL,DRIED'), 3),
    (v_r, pg_temp.mp_ing('Smoked Paprika', 'tsp', 'PAPRIKA'), 1.5),
    (v_r, pg_temp.mp_ing('Crushed Red Pepper', 'tsp', 'PEPPER,RED OR CAYENNE'), 0.8),
    (v_r, pg_temp.mp_ing('Canned Tomatoes', 'g', 'TOMATOES,RED,RIPE,CND,PACKED IN TOMATO JUC'), 2460),
    (v_r, pg_temp.mp_ing('Vegetable Boullion', 'oz', 'SOUP,BOUILLON CUBES&GRANULES,LO NA,DRY'), 1.27),         -- 6 tsp Better Than Bouillon ≈ 36 g
    (v_r, pg_temp.mp_ing('Sugar', 'g', 'SUGARS,GRANULATED'), 12),                                              -- 3 tsp
    (v_r, pg_temp.mp_ing('Basil', 'g', 'BASIL,FRESH'), 60),
    (v_r, pg_temp.mp_ing('Evaporated Milk', 'g', 'MILK,CND,EVAP,W/ VIT A'), 1062),
    (v_r, pg_temp.mp_ing('Balsamic Glaze', 'tsp', null), 3),
    (v_r, pg_temp.mp_ing('Salt', 'tsp', 'SALT,TABLE'), 3),
    (v_r, pg_temp.mp_ing('Pepper', 'oz', 'PEPPER,BLACK'), 0.12);                                               -- 1.5 tsp
    -- water (900 ml) is in the written ingredient list but not tracked: no
    -- nutrition, and it does not belong on a shopping list
    raise notice 'Added Crock Pot Tomato Basil Bisque (id %)', v_r;
  end if;

end $body$;

-- What got added
select r.name, r.servings, count(ri.id) as ingredients
from recipes r left join recipe_ingredients ri on ri.recipe_id = r.id
where r.name = 'Crock Pot Tomato Basil Bisque'
group by r.id order by r.name;
