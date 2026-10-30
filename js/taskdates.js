/* Date rules for tasks, kept free of DOM and Supabase imports so the Node tests
   can load them.

   Task dates are 'YYYY-MM-DD' keys, the same shape as the tasks.due column.
   Arithmetic runs in UTC so a daylight-saving change can't land a step on the
   wrong date; only keyOf() reads the local calendar.

   Saturday is a rest day (Sabbath, Friday sunset to Saturday sunset), so
   nothing should come due on one. The app steers around it but never blocks
   it: a Saturday picked on purpose stays a Saturday. */

const SAT = 6;

export const keyOf = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
export const todayKey = () => keyOf(new Date());

const toUTC = key => { const [y, m, d] = key.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const fromUTC = x => x.toISOString().slice(0, 10);
export const isKey = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

export function addDaysKey(key, n){
  const x = toUTC(key);
  x.setUTCDate(x.getUTCDate() + n);
  return fromUTC(x);
}
/* whole days from a to b (b later → positive) */
export const daysBetween = (a, b) => Math.round((toUTC(b) - toUTC(a)) / 86400000);
export const dowOf = key => toUTC(key).getUTCDay();

export const isRestDay = key => isKey(key) && dowOf(key) === SAT;

/* the day after `key`, stepping over Saturday: Friday → Sunday */
export function nextTaskDay(key){
  const next = addDaysKey(key, 1);
  return isRestDay(next) ? addDaysKey(next, 1) : next;
}

/* what to offer instead of a Saturday: the Sunday after, or the Friday before
   (admin day) */
export const restDayAlternatives = key => ({ sunday: addDaysKey(key, 1), friday: addDaysKey(key, -1) });
