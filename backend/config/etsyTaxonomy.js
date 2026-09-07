// Etsy taksonomi property değer eşlemeleri — Wall Decor (node 1027)
// routes/etsy.js ve services/ListingUploadService.js tarafından paylaşılır.
// Etsy taxonomy property value mappings for Wall Decor (node 1027)
const STYLE_MAPPING = {
  "Art deco": 2382,
  "Bohemian & eclectic": 2384,
  "Coastal & tropical": 2385,
  "Contemporary": 2387,
  "Country & farmhouse": 2388,
  "Gothic": 2409,
  "Lodge": 2391,
  "Mid-century": 2392,
  "Minimalist": 2393,
  "Rustic & primitive": 2395,
  "Victorian": 2399
};

const OCCASION_MAPPING = {
  "1st birthday": 2773,
  "Anniversary": 12,
  "Baby shower": 13,
  "Bachelor party": 14,
  "Bachelorette party": 15,
  "Back to school": 16,
  "Baptism": 17,
  "Bar & Bat Mitzvah": 18,
  "Birthday": 19,
  "Bridal shower": 20,
  "Confirmation": 21,
  "Divorce & breakup": 26,
  "Engagement": 22,
  "First Communion": 23,
  "Graduation": 24,
  "Grief & mourning": 25,
  "Housewarming": 27,
  "LGBTQ pride": 2774,
  "Moving": 50,
  "Pet loss": 28,
  "Prom": 29,
  "Quinceañera & Sweet 16": 30,
  "Retirement": 31,
  "Wedding": 32
};

const HOLIDAY_MAPPING = {
  "Christmas": 35,
  "Cinco de Mayo": 36,
  "Dia de los Muertos": 5126,
  "Diwali": 4562,
  "Easter": 37,
  "Eid": 4564,
  "Father's Day": 38,
  "Halloween": 39,
  "Hanukkah": 40,
  "Holi": 4563,
  "Independence Day": 41,
  "Kwanzaa": 42,
  "Lunar New Year": 34,
  "Mardi Gras": 5118,
  "Mother's Day": 43,
  "New Year's": 44,
  "Passover": 47,
  "Ramadan": 5128,
  "St Patrick's Day": 45,
  "Thanksgiving": 46,
  "Valentine's Day": 48,
  "Veterans Day": 49
};

const ROOM_MAPPING = {
  "Bar": 4424,
  "Bathroom": 2356,
  "Bedroom": 2354,
  "Craft": 2360,
  "Dorm": 3946,
  "Entryway": 2353,
  "Game room": 3947,
  "Garage": 2361,
  "Kids": 2357,
  "Kitchen & dining": 2350,
  "Laundry": 2359,
  "Living room": 2351,
  "Man cave": 4425,
  "Nursery": 2358,
  "Office": 2352,
  "Patio & outdoor": 2355,
  "Porch": 4426
};

const MATERIALS_MAPPING = {
  "Canvas": 74,
  "Cotton": 102,
  "Fabric": 118,
  "Paper": 196,
  "Wood": 286
};

export { STYLE_MAPPING, OCCASION_MAPPING, HOLIDAY_MAPPING, ROOM_MAPPING, MATERIALS_MAPPING };
