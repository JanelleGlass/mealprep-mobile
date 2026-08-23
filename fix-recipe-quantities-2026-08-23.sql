-- Corrects six recipe quantities that were stored in the wrong unit.
-- Paste the whole file into the Supabase SQL Editor and Run, then read the
-- LAST result grid: one row per correction, each with a status.
--
-- WHY THESE ARE WRONG
-- The add-recipes-*.sql files create an ingredient only when no ingredient of
-- that name exists; when one does, mp_ing returns it and the unit passed in is
-- discarded. Four ingredients were already in the database under a different
-- unit than those files assumed, so the quantities were read in the stored
-- unit instead of the intended one:
--
--   Sugar        stored in oz   (003_core.sql id 26)      -- files assumed g
--   butter       stored in oz   (003_core.sql id 80)      -- 08-08 assumed tbsp
--   Blueberries  stored in g    (add-recipes-2026-07-09)  -- 08-08 assumed cup
--   Lemon Juice  stored in tbsp (add-recipes-2026-07-09)  -- 08-08 assumed cup
--
-- SAFE TO RE-RUN, AND SAFE IF YOU ALREADY FIXED SOME BY HAND
-- A row is only rewritten when the ingredient is STILL stored in the unit named
-- below AND the quantity is STILL the uncorrected value. Re-running changes
-- nothing. Every one of the six is accounted for in the final grid, including
-- ones this file deliberately refused to touch, so nothing is silently skipped.
--
-- IF A STATUS SAYS "UNIT CHANGED", READ THIS FIRST
-- It means the ingredient is no longer stored in the unit this fix assumed --
-- most likely because you repaired it the other way, by changing the unit
-- rather than the quantity. In that case the quantity is probably already
-- right, and "should be" in the grid DOES NOT APPLY: it is stated in the old
-- unit. Do not copy it in. Units live on the ingredient and are shared by every
-- recipe using it, so changing one to suit a single recipe rescales all the
-- others -- e.g. Blueberries is used by both Blueberry Lemon Pie and Overnight
-- Chia Oats.

drop table if exists mp_plan;
create temp table mp_plan (
  recipe text, ingredient text, expect_unit text,
  wrong_qty numeric, right_qty numeric, why text
);

insert into mp_plan (recipe, ingredient, expect_unit, wrong_qty, right_qty, why) values
  ('Blueberry Lemon Pie', 'Sugar',       'oz',   157.5, round(157.5 / 28.3495, 4), '157.5 g read as 157.5 oz'),
  ('Blueberry Lemon Pie', 'Butter',      'oz',   6,     3,                          '6 tbsp butter = 3 oz'),
  ('Blueberry Lemon Pie', 'Blueberries', 'g',    2,     296,                        '2 cups x 148 g, the USDA gm_wt for BLUEBERRIES,RAW'),
  ('Blueberry Lemon Pie', 'Lemon Juice', 'tbsp', 0.36,  round(0.36 * 16, 4),        '0.36 cup = 5.76 tbsp'),
  ('Tall, Crisp-Edged Whole-Grain Pancakes', 'Sugar', 'oz', 25, round(25 / 28.3495, 4), '25 g read as 25 oz'),
  ('Crock Pot Tomato Basil Bisque',          'Sugar', 'oz', 12, round(12 / 28.3495, 4), '12 g read as 12 oz');

-- The correction. Set-based on purpose: if an ingredient somehow appears twice
-- in one recipe, every matching row is fixed, not just the first. The unit and
-- quantity conditions are what make this safe to re-run and safe against a row
-- you already repaired by hand -- neither matches once the row is correct.
update recipe_ingredients ri
   set quantity = p.right_qty
  from mp_plan p, recipes r, ingredients i
 where r.id = ri.recipe_id
   and i.id = ri.ingredient_id
   and lower(r.name) = lower(p.recipe)
   and lower(i.name) = lower(p.ingredient)
   and lower(i.unit) = lower(p.expect_unit)
   and abs(ri.quantity - p.wrong_qty) < 0.0001;

-- Every ingredient in the three affected recipes, with the unit it is actually
-- stored in, so you can scan for any OTHER amount written in one unit and
-- stored in another. Read it against the written amounts in the description.
select r.name as recipe, i.name as ingredient, ri.quantity, i.unit
from recipe_ingredients ri
join recipes r on r.id = ri.recipe_id
join ingredients i on i.id = ri.ingredient_id
where lower(r.name) in (lower('Blueberry Lemon Pie'),
                        lower('Tall, Crisp-Edged Whole-Grain Pancakes'),
                        lower('Crock Pot Tomato Basil Bisque'))
order by r.name, i.name;

-- THE ONE TO READ. Always six rows, one per correction, whatever happened.
-- Driven off mp_plan with a left join, so a recipe or ingredient that no longer
-- matches by name shows up as MISSING instead of quietly dropping out. Status
-- is unit-aware: a row stored in a different unit than this fix assumed is
-- called out rather than judged against a "should be" that no longer applies.
select p.recipe,
       p.ingredient,
       coalesce(a.stored, '(not found)')                    as stored_now,
       p.right_qty::text || ' ' || p.expect_unit            as should_be,
       case
         when a.n = 0            then 'MISSING - recipe or ingredient renamed? nothing was changed'
         when a.n_other_unit > 0 then 'UNIT CHANGED - ignore "should be"; see the note at the top'
         when a.n_right = a.n    then 'ok'
         else                         'CHECK - quantity is not what this fix expected; look at it by hand'
       end                                                  as status,
       p.why
from mp_plan p
left join lateral (
  select count(*)                                                            as n,
         count(*) filter (where lower(i.unit) <> lower(p.expect_unit))       as n_other_unit,
         count(*) filter (where lower(i.unit) = lower(p.expect_unit)
                            and abs(ri.quantity - p.right_qty) < 0.0001)     as n_right,
         string_agg(ri.quantity::text || ' ' || i.unit, ', ' order by ri.id)  as stored
  from recipe_ingredients ri
  join recipes r on r.id = ri.recipe_id
  join ingredients i on i.id = ri.ingredient_id
  where lower(r.name) = lower(p.recipe)
    and lower(i.name) = lower(p.ingredient)
) a on true
order by p.recipe, p.ingredient;
