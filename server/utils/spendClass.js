/**
 * Needs vs wants, read off a category code. The longest listed prefix wins, so
 * groceries stay essential under a discretionary Food group. Unlisted codes are
 * 'other' — never guessed.
 */
const CLASSES = {
  'tp_housing':                 'essential',
  'tp_education':               'essential',
  'tp_food/ts_groceries':       'essential',
  'tp_health/ts_doctor':        'essential',
  'tp_health/ts_pharmacy':      'essential',
  'tp_health/ts_health_ins':    'essential',
  'tp_transport/ts_fuel':       'essential',
  'tp_transport/ts_public_transit': 'essential',
  'tp_transport/ts_parking':    'essential',
  'tp_food':                    'discretionary',
  'tp_entertainment':           'discretionary',
  'tp_shopping':                'discretionary',
  'tp_travel':                  'discretionary',
  'tp_subscriptions':           'discretionary',
  'tp_transport/ts_rideshare':  'discretionary',
  'tp_health/ts_fitness':       'discretionary',
  'tp_other_exp/ts_gifts_sent': 'discretionary',
  'tp_other_exp/ts_donations':  'discretionary',
};
const PREFIXES = Object.keys(CLASSES).sort((a, b) => b.length - a.length);

function spendClass(code) {
  if (!code) return 'other';
  const hit = PREFIXES.find(p => code === p || code.startsWith(`${p}/`));
  return hit ? CLASSES[hit] : 'other';
}

module.exports = { spendClass };
