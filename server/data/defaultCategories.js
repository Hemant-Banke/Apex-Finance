const DEFAULT_CATEGORIES = [
  // ═══ EXPENSE — Primary ═══
  { code: 'tp_food',          name: 'Food & Dining',     emoji: '🍔', level: 'primary',   parent: null,             applicableTo: ['expense'] },
  { code: 'tp_transport',     name: 'Transport',         emoji: '🚗', level: 'primary',   parent: null,             applicableTo: ['expense'] },
  { code: 'tp_housing',       name: 'Housing',           emoji: '🏠', level: 'primary',   parent: null,             applicableTo: ['expense'] },
  { code: 'tp_health',        name: 'Healthcare',        emoji: '🏥', level: 'primary',   parent: null,             applicableTo: ['expense'] },
  { code: 'tp_entertainment', name: 'Entertainment',     emoji: '🎭', level: 'primary',   parent: null,             applicableTo: ['expense'] },
  { code: 'tp_shopping',      name: 'Shopping',          emoji: '🛍️', level: 'primary',   parent: null,             applicableTo: ['expense'] },
  { code: 'tp_education',     name: 'Education',         emoji: '📚', level: 'primary',   parent: null,             applicableTo: ['expense'] },
  { code: 'tp_travel',        name: 'Travel',            emoji: '✈️', level: 'primary',   parent: null,             applicableTo: ['expense'] },
  { code: 'tp_subscriptions', name: 'Subscriptions',     emoji: '🔔', level: 'primary',   parent: null,             applicableTo: ['expense'] },
  { code: 'tp_other_exp',     name: 'Other',             emoji: '📋', level: 'primary',   parent: null,             applicableTo: ['expense'] },

  // ═══ EXPENSE — Secondary (Food) ═══
  { code: 'ts_restaurants',   name: 'Restaurants',       emoji: '🍽️', level: 'secondary', parent: 'tp_food',        applicableTo: ['expense'] },
  { code: 'ts_groceries',     name: 'Groceries',         emoji: '🛒', level: 'secondary', parent: 'tp_food',        applicableTo: ['expense'] },
  { code: 'ts_coffee',        name: 'Café & Coffee',     emoji: '☕', level: 'secondary', parent: 'tp_food',        applicableTo: ['expense'] },
  { code: 'ts_takeaway',      name: 'Takeaway',          emoji: '📦', level: 'secondary', parent: 'tp_food',        applicableTo: ['expense'] },

  // ═══ EXPENSE — Secondary (Transport) ═══
  { code: 'ts_fuel',          name: 'Fuel',              emoji: '⛽', level: 'secondary', parent: 'tp_transport',   applicableTo: ['expense'] },
  { code: 'ts_public_transit',name: 'Public Transit',    emoji: '🚌', level: 'secondary', parent: 'tp_transport',   applicableTo: ['expense'] },
  { code: 'ts_rideshare',     name: 'Cab & Rideshare',   emoji: '🚕', level: 'secondary', parent: 'tp_transport',   applicableTo: ['expense'] },
  { code: 'ts_parking',       name: 'Parking & Tolls',   emoji: '🅿️', level: 'secondary', parent: 'tp_transport',   applicableTo: ['expense'] },

  // ═══ EXPENSE — Secondary (Housing) ═══
  { code: 'ts_rent',          name: 'Rent',              emoji: '🏡', level: 'secondary', parent: 'tp_housing',     applicableTo: ['expense'] },
  { code: 'ts_utilities',     name: 'Utilities',         emoji: '💡', level: 'secondary', parent: 'tp_housing',     applicableTo: ['expense'] },
  { code: 'ts_maintenance',   name: 'Maintenance',       emoji: '🔧', level: 'secondary', parent: 'tp_housing',     applicableTo: ['expense'] },
  { code: 'ts_home_ins',      name: 'Home Insurance',    emoji: '🛡️', level: 'secondary', parent: 'tp_housing',     applicableTo: ['expense'] },

  // ═══ EXPENSE — Secondary (Health) ═══
  { code: 'ts_doctor',        name: 'Doctor & Hospital', emoji: '👨‍⚕️', level: 'secondary', parent: 'tp_health',      applicableTo: ['expense'] },
  { code: 'ts_pharmacy',      name: 'Pharmacy',          emoji: '💊', level: 'secondary', parent: 'tp_health',      applicableTo: ['expense'] },
  { code: 'ts_fitness',       name: 'Fitness & Gym',     emoji: '💪', level: 'secondary', parent: 'tp_health',      applicableTo: ['expense'] },
  { code: 'ts_health_ins',    name: 'Health Insurance',  emoji: '🩺', level: 'secondary', parent: 'tp_health',      applicableTo: ['expense'] },

  // ═══ EXPENSE — Secondary (Entertainment) ═══
  { code: 'ts_movies',        name: 'Movies & Shows',    emoji: '🎬', level: 'secondary', parent: 'tp_entertainment', applicableTo: ['expense'] },
  { code: 'ts_gaming',        name: 'Gaming',            emoji: '🎮', level: 'secondary', parent: 'tp_entertainment', applicableTo: ['expense'] },
  { code: 'ts_streaming',     name: 'Streaming',         emoji: '📺', level: 'secondary', parent: 'tp_entertainment', applicableTo: ['expense'] },
  { code: 'ts_events',        name: 'Events & Concerts', emoji: '🎪', level: 'secondary', parent: 'tp_entertainment', applicableTo: ['expense'] },

  // ═══ EXPENSE — Secondary (Shopping) ═══
  { code: 'ts_clothing',      name: 'Clothing',          emoji: '👕', level: 'secondary', parent: 'tp_shopping',    applicableTo: ['expense'] },
  { code: 'ts_electronics',   name: 'Electronics',       emoji: '📱', level: 'secondary', parent: 'tp_shopping',    applicableTo: ['expense'] },
  { code: 'ts_home_goods',    name: 'Home & Decor',      emoji: '🪴', level: 'secondary', parent: 'tp_shopping',    applicableTo: ['expense'] },
  { code: 'ts_personal_care', name: 'Personal Care',     emoji: '🧴', level: 'secondary', parent: 'tp_shopping',    applicableTo: ['expense'] },

  // ═══ EXPENSE — Secondary (Education) ═══
  { code: 'ts_tuition',       name: 'Tuition & Fees',    emoji: '🏫', level: 'secondary', parent: 'tp_education',   applicableTo: ['expense'] },
  { code: 'ts_books',         name: 'Books & Stationery',emoji: '📖', level: 'secondary', parent: 'tp_education',   applicableTo: ['expense'] },
  { code: 'ts_courses',       name: 'Online Courses',    emoji: '🎓', level: 'secondary', parent: 'tp_education',   applicableTo: ['expense'] },

  // ═══ EXPENSE — Secondary (Travel) ═══
  { code: 'ts_flights',       name: 'Flights',           emoji: '✈️', level: 'secondary', parent: 'tp_travel',      applicableTo: ['expense'] },
  { code: 'ts_hotels',        name: 'Hotels & Stays',    emoji: '🏨', level: 'secondary', parent: 'tp_travel',      applicableTo: ['expense'] },
  { code: 'ts_travel_act',    name: 'Activities & Tours',emoji: '🗺️', level: 'secondary', parent: 'tp_travel',      applicableTo: ['expense'] },

  // ═══ EXPENSE — Secondary (Subscriptions) ═══
  { code: 'ts_software_sub',  name: 'Software & Apps',   emoji: '💻', level: 'secondary', parent: 'tp_subscriptions', applicableTo: ['expense'] },
  { code: 'ts_media_sub',     name: 'Media & Streaming', emoji: '🎵', level: 'secondary', parent: 'tp_subscriptions', applicableTo: ['expense'] },
  { code: 'ts_services_sub',  name: 'Services',          emoji: '🔧', level: 'secondary', parent: 'tp_subscriptions', applicableTo: ['expense'] },

  // ═══ EXPENSE — Secondary (Other) ═══
  { code: 'ts_gifts_sent',    name: 'Gifts Given',       emoji: '🎁', level: 'secondary', parent: 'tp_other_exp',   applicableTo: ['expense'] },
  { code: 'ts_donations',     name: 'Donations',         emoji: '❤️', level: 'secondary', parent: 'tp_other_exp',   applicableTo: ['expense'] },
  { code: 'ts_misc_exp',      name: 'Miscellaneous',     emoji: '📋', level: 'secondary', parent: 'tp_other_exp',   applicableTo: ['expense'] },

  // ═══ INCOME — Primary ═══
  { code: 'tp_employment',    name: 'Employment',        emoji: '💼', level: 'primary',   parent: null,             applicableTo: ['income'] },
  { code: 'tp_investments_inc',name: 'Investments',      emoji: '📈', level: 'primary',   parent: null,             applicableTo: ['income'] },
  { code: 'tp_rental_inc',    name: 'Rental Income',     emoji: '🏘️', level: 'primary',   parent: null,             applicableTo: ['income'] },
  { code: 'tp_business_inc',  name: 'Business',          emoji: '🏢', level: 'primary',   parent: null,             applicableTo: ['income'] },
  { code: 'tp_other_inc',     name: 'Other Income',      emoji: '📋', level: 'primary',   parent: null,             applicableTo: ['income'] },

  // ═══ INCOME — Secondary (Employment) ═══
  { code: 'ts_salary',        name: 'Salary',            emoji: '💰', level: 'secondary', parent: 'tp_employment',  applicableTo: ['income'] },
  { code: 'ts_bonus',         name: 'Bonus & Incentives',emoji: '🎯', level: 'secondary', parent: 'tp_employment',  applicableTo: ['income'] },
  { code: 'ts_freelance',     name: 'Freelance',         emoji: '💻', level: 'secondary', parent: 'tp_employment',  applicableTo: ['income'] },

  // ═══ INCOME — Secondary (Investments) ═══
  { code: 'ts_dividends',     name: 'Dividends',         emoji: '💹', level: 'secondary', parent: 'tp_investments_inc', applicableTo: ['income'] },
  { code: 'ts_interest',      name: 'Interest',          emoji: '🏦', level: 'secondary', parent: 'tp_investments_inc', applicableTo: ['income'] },
  { code: 'ts_capital_gains', name: 'Capital Gains',     emoji: '📊', level: 'secondary', parent: 'tp_investments_inc', applicableTo: ['income'] },

  // ═══ INCOME — Secondary (Rental) ═══
  { code: 'ts_property_rent', name: 'Property Rent',     emoji: '🏠', level: 'secondary', parent: 'tp_rental_inc',  applicableTo: ['income'] },
  { code: 'ts_other_rental',  name: 'Other Rental',      emoji: '📋', level: 'secondary', parent: 'tp_rental_inc',  applicableTo: ['income'] },

  // ═══ INCOME — Secondary (Business) ═══
  { code: 'ts_biz_revenue',   name: 'Revenue',           emoji: '💰', level: 'secondary', parent: 'tp_business_inc',applicableTo: ['income'] },
  { code: 'ts_other_biz',     name: 'Other Business',    emoji: '📋', level: 'secondary', parent: 'tp_business_inc',applicableTo: ['income'] },

  // ═══ INCOME — Secondary (Other) ═══
  { code: 'ts_gifts_received',name: 'Gifts Received',    emoji: '🎁', level: 'secondary', parent: 'tp_other_inc',   applicableTo: ['income'] },
  { code: 'ts_refunds',       name: 'Refunds & Cashback',emoji: '💫', level: 'secondary', parent: 'tp_other_inc',   applicableTo: ['income'] },
  { code: 'ts_misc_inc',      name: 'Miscellaneous',     emoji: '📋', level: 'secondary', parent: 'tp_other_inc',   applicableTo: ['income'] },
];

async function seedDefaultCategories(Category) {
  const count = await Category.countDocuments();
  if (count === 0) {
    await Category.insertMany(DEFAULT_CATEGORIES);
    console.log('✅ Default transaction categories seeded');
  }
}

module.exports = { DEFAULT_CATEGORIES, seedDefaultCategories };
