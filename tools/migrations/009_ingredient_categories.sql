-- Ingredient sections: moves the pantry section from the pantry row onto the
-- ingredient itself. Run in the Supabase SQL Editor after 008. Safe to re-run.
--
-- Why: the section was only ever stored on pantry_items, so the Ingredients list
-- had to borrow it, an ingredient you don't currently stock could not be filed
-- at all, and the section could only be changed from the Pantry side. An
-- ingredient's section is a property of the ingredient, not of having some on
-- hand, so it belongs here.

alter table ingredients add column if not exists category text not null default '';

-- Carry over what the pantry rows already know. Only fills blanks, so re-running
-- never overwrites a section you have since changed in the app.
update ingredients i
set category = p.category
from pantry_items p
where p.ingredient_id = i.id
  and i.category = ''
  and p.category <> '';

-- pantry_items.category is now unused by the app. It is deliberately left in
-- place rather than dropped: it is the backup for this migration. Once the
-- Ingredients list looks right, it can be dropped in a later migration with
--   alter table pantry_items drop column category;

select coalesce(nullif(category, ''), '(unfiled -> Other)') as section, count(*)
from ingredients group by 1 order by 2 desc;
