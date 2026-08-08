-- Drops the now-unused pantry_items.category. Run in the Supabase SQL Editor
-- after 009. Safe to re-run.
--
-- 009 moved the section onto the ingredient and left this column alone as its
-- backup. Nothing in the app has read or written it since. This drop is the
-- point of no return for that backup, so it refuses to run unless 009 has
-- actually done its job: the guard below aborts the whole thing if
-- ingredients.category is missing, or if any pantry row still holds a section
-- its ingredient hasn't got.

do $$
declare
  unmigrated int;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ingredients' and column_name = 'category'
  ) then
    raise exception 'ingredients.category does not exist — run 009_ingredient_categories.sql first';
  end if;

  -- nothing to check if the column is already gone (re-run)
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'pantry_items' and column_name = 'category'
  ) then
    select count(*) into unmigrated
    from pantry_items p
    join ingredients i on i.id = p.ingredient_id
    where coalesce(p.category, '') <> '' and coalesce(i.category, '') = '';

    if unmigrated > 0 then
      raise exception
        '% pantry row(s) still hold a section the ingredient does not — run 009_ingredient_categories.sql first', unmigrated;
    end if;
  end if;
end $$;

alter table pantry_items drop column if exists category;

-- Note: migration-out/007_pantry_categories.sql, from the original one-time
-- import, adds this column. If that whole sequence is ever replayed on a fresh
-- database, run this file again afterwards.

select count(*) as pantry_rows,
       count(*) filter (where coalesce(i.category, '') <> '') as filed_by_ingredient
from pantry_items p join ingredients i on i.id = p.ingredient_id;
