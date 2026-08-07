-- Recipe variations: a variation is a recipe in its own right that remembers
-- which recipe it came from. Run in the Supabase SQL Editor after 007.
-- Safe to re-run.
--
-- Why a full copy rather than a stored set of differences: meals.recipe_id, the
-- cook plan and the food log all point at a recipe id, so a variation that IS a
-- recipe needs no changes anywhere downstream. It also keeps history honest —
-- editing the base recipe later can't rewrite the nutrition of a variation you
-- already cooked and logged.
--
-- on delete set null, not cascade: deleting a base recipe promotes its
-- variations to top-level recipes instead of silently taking them with it.

alter table recipes
  add column if not exists parent_recipe_id int references recipes(id) on delete set null;

create index if not exists recipes_parent_idx on recipes(parent_recipe_id);

-- A variation of a variation would nest without limit; the app only ever offers
-- "make a variation" on a base, and this keeps a hand-written row honest too.
alter table recipes drop constraint if exists recipes_parent_not_self;
alter table recipes add constraint recipes_parent_not_self check (parent_recipe_id is distinct from id);

select count(*) filter (where parent_recipe_id is null) as base_recipes,
       count(*) filter (where parent_recipe_id is not null) as variations
from recipes;
