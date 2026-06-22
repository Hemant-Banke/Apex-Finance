// Priority-ordered rules — first match wins
const RULES = [
  // ─── Food ───
  { kw: ['SWIGGY', 'ZOMATO', 'DUNZO', 'FOODPANDA', 'EATSURE', 'FASSOS', 'BOX8'], expense: 'tp_food/ts_takeaway' },
  { kw: ['BLINKIT', 'ZEPTO', 'BIGBASKET', 'GROFERS', 'INSTAMART', 'DMART', 'RELIANCE FRESH', 'SUPR DAILY', 'GROCERY', 'KIRANA'], expense: 'tp_food/ts_groceries' },
  { kw: ['RESTAURANT', 'DINING', 'DOMINOS', 'PIZZA HUT', 'BURGER KING', 'KFC', 'MCDONALDS', 'SUBWAY', 'BIRYANI', 'CHINESE', 'DHABA'], expense: 'tp_food/ts_restaurants' },
  { kw: ['STARBUCKS', 'CCD', 'CAFE', 'COFFEE', 'TEA POINT', 'CHAI', 'BLUE TOKAI'], expense: 'tp_food/ts_coffee' },

  // ─── Transport ───
  { kw: ['UBER', 'OLA CABS', 'RAPIDO', 'BOUNCE', 'YULU', 'MERU', 'QUICK RIDE', 'BLUEBIRD'], expense: 'tp_transport/ts_rideshare' },
  { kw: ['PETROL', 'DIESEL', 'FUEL', 'BPCL', 'HPCL', 'IOCL', 'HP PETRO', 'BHARAT PETROLEUM', 'INDIAN OIL', 'SHELL', 'NAYARA'], expense: 'tp_transport/ts_fuel' },
  { kw: ['IRCTC', 'RAILWAY', 'METRO', 'BMTC', 'KSRTC', 'REDBUS', 'BUS TICKET', 'TRAIN TICKET'], expense: 'tp_transport/ts_public_transit' },
  { kw: ['FASTAG', 'TOLL', 'PARKING', 'NWD', 'ATM CASH'], expense: 'tp_transport/ts_parking' },

  // ─── Healthcare ───
  { kw: ['HOSPITAL', 'CLINIC', 'DOCTOR', 'HEALTH CARE', 'HEALTHCARE', 'APOLLO', 'FORTIS', 'MANIPAL', 'LIFE CARE', 'COLUMBIA ASIA', 'NARAYANA', 'ASTER'], expense: 'tp_health/ts_doctor' },
  { kw: ['PHARMA', 'PHARMACY', 'MEDPLUS', 'NETMEDS', 'PHARMEASY', '1MG', 'TATA 1MG', 'WELLNESS', 'CHEMIST', 'MEDICINE'], expense: 'tp_health/ts_pharmacy' },
  { kw: ['GYM', 'FITNESS', 'CULT FIT', 'CURE FIT', 'CROSSFIT', 'YOGA', 'ANYTIME FITNESS', 'GOLD GYM', 'SNAP FITNESS'], expense: 'tp_health/ts_fitness' },
  { kw: ['INSURANCE', 'LIC', 'ICICI PRU', 'HDFC LIFE', 'MAX LIFE', 'BAJAJ ALLIANZ', 'STAR HEALTH'], expense: 'tp_health/ts_health_ins' },

  // ─── Housing ───
  { kw: ['RENT PAID', 'LANDLORD', 'HOUSE RENT', 'PG RENT', 'FLAT RENT', 'MONTHLY RENT'], expense: 'tp_housing/ts_rent' },
  { kw: ['ELECTRICITY', 'BESCOM', 'MSEB', 'TNEB', 'TATA POWER', 'ADANI ELECTRIC', 'POWER BILL', 'WATER BOARD', 'GAS BILL', 'UTILITY BILL', 'BWSSB'], expense: 'tp_housing/ts_utilities' },
  { kw: ['MAINTENANCE', 'HOUSING SOCIETY', 'APARTMENT ASSOC', 'FLAT MAINTENANCE'], expense: 'tp_housing/ts_maintenance' },

  // ─── Entertainment ───
  { kw: ['NETFLIX', 'HOTSTAR', 'PRIME VIDEO', 'ZEE5', 'SONYLIV', 'DISNEY', 'JIOCINEMA', 'MXPLAYER', 'VOOT', 'ALT BALAJI'], expense: 'tp_entertainment/ts_streaming' },
  { kw: ['BOOKMYSHOW', 'PVR', 'INOX', 'CINEPOLIS', 'MOVIE TICKET', 'CINEMA'], expense: 'tp_entertainment/ts_movies' },
  { kw: ['STEAM', 'XBOX', 'PLAYSTATION', 'GAMING', 'PLAY STORE GAMES', 'EPIC GAMES'], expense: 'tp_entertainment/ts_gaming' },
  { kw: ['PAYTM INSIDER', 'DISTRICT APP', 'TICKETMASTER', 'CONCERT', 'LIVE EVENT'], expense: 'tp_entertainment/ts_events' },

  // ─── Shopping ───
  { kw: ['AMAZON', 'FLIPKART', 'MEESHO', 'NYKAA', 'AJIO', 'SNAPDEAL', 'SHOPSY'], expense: 'tp_shopping' },
  { kw: ['MYNTRA', 'ZARA', 'H&M', 'LIFESTYLE', 'WESTSIDE', 'FABINDIA', 'CLOTHING', 'FASHION', 'APPAREL'], expense: 'tp_shopping/ts_clothing' },
  { kw: ['CROMA', 'VIJAY SALES', 'RELIANCE DIGITAL', 'SAMSUNG STORE', 'APPLE STORE', 'ELECTRONIC'], expense: 'tp_shopping/ts_electronics' },
  { kw: ['IKEA', 'PEPPERFRY', 'URBAN LADDER', 'NILKAMAL', 'HOME CENTRE', 'DECOR', 'FURNITURE', 'GODREJ INTERIO'], expense: 'tp_shopping/ts_home_goods' },
  { kw: ['NYKAA', 'SUGAR COSMETICS', 'MAMAEARTH', 'WOW', 'BEARDO', 'MCAFFEINE', 'PERSONAL CARE', 'SALON', 'PARLOUR', 'SPA'], expense: 'tp_shopping/ts_personal_care' },

  // ─── Travel ───
  { kw: ['MAKEMYTRIP', 'GOIBIBO', 'IXIGO', 'CLEARTRIP', 'INDIGO', 'SPICEJET', 'AIR INDIA', 'VISTARA', 'AKASA AIR', 'AIRLINE', 'FLIGHT TICKET'], expense: 'tp_travel/ts_flights' },
  { kw: ['OYO', 'AIRBNB', 'BOOKING.COM', 'TREEBO', 'FABHOTEL', 'RESORT', 'HOTEL', 'HOLIDAY INN', 'MARRIOTT'], expense: 'tp_travel/ts_hotels' },
  { kw: ['TRIP ACTIVITY', 'THRILLOPHILIA', 'HEADOUT', 'GET YOUR GUIDE'], expense: 'tp_travel/ts_travel_act' },

  // ─── Subscriptions ───
  { kw: ['SPOTIFY', 'APPLE MUSIC', 'GAANA', 'WYNK', 'JIOSAAVN', 'AMAZON MUSIC'], expense: 'tp_subscriptions/ts_media_sub' },
  { kw: ['INDMONEY', 'ZERODHA', 'GROWW', 'KUVERA', 'FINZOOM', 'SMALLCASE', 'PAYTM MONEY', 'ANGEL BROKING', 'UPSTOX', 'IIFL', 'RECURRINGMANDATE'], expense: 'tp_subscriptions/ts_services_sub' },
  { kw: ['GOOGLE ONE', 'MICROSOFT', 'ADOBE', 'NOTION', 'DROPBOX', 'GITHUB', 'SLACK', 'ZOOM', 'ATLASSIAN', 'SOFTWARE SUBSCRIPTION'], expense: 'tp_subscriptions/ts_software_sub' },

  // ─── Education ───
  { kw: ['SCHOOL FEE', 'COLLEGE FEE', 'TUITION FEE', 'UDEMY', 'COURSERA', 'LINKEDIN LEARNING', 'BYJUS', 'UNACADEMY', 'VEDANTU', 'TEACHABLE'], expense: 'tp_education' },

  // ─── Income ───
  { kw: ['SALARY', 'PAYROLL', 'WAGES', 'STIPEND', 'SAL CR'], income: 'tp_employment/ts_salary' },
  { kw: ['BONUS', 'INCENTIVE', 'PERFORMANCE PAY', 'AWARD AMOUNT', 'PERFORMANCE BONUS'], income: 'tp_employment/ts_bonus' },
  { kw: ['FREELANCE', 'CONSULTING FEE', 'PROJECT PAYMENT', 'INVOICE PAYMENT', 'CLIENT PAYMENT'], income: 'tp_employment/ts_freelance' },
  { kw: ['DIVIDEND', 'INTEREST CREDIT', 'FD INTEREST', 'RD INTEREST', 'BOND INTEREST', 'FD MATURITY'], income: 'tp_investments_inc/ts_interest' },
  { kw: ['REFUND', 'CASHBACK', 'REVERSAL', 'RETURN CREDIT', 'CREDIT REVERSAL'], income: 'tp_other_inc/ts_refunds' },
  { kw: ['RENT RECEIVED', 'RENTAL INCOME', 'TENANT PAYMENT'], income: 'tp_rental_inc/ts_property_rent' },
];

function autoCategory(narration, type) {
  const upper = narration.toUpperCase();
  for (const rule of RULES) {
    const matches = rule.kw.some(k => upper.includes(k));
    if (!matches) continue;
    if (type === 'expense' && rule.expense) return rule.expense;
    if (type === 'income' && rule.income) return rule.income;
  }
  return null;
}

module.exports = { autoCategory };
