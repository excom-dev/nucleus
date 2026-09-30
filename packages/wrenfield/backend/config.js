const TRADE_DISCOUNT = 0.15;
const DEPOSIT_SHARE = 0.5;
const HOLD_MINUTES = 15;
const FIRST_ORDER_NUMBER = 24001;
const RAIL_LENGTH = 8;
const RELATED_LENGTH = 4;
const RECENT_LENGTH = 8;
const SUMMARY_AMOUNTS = ["subtotal", "tradeDiscount", "deliveryFee", "total", "dueToday", "dueLater"];

const CATEGORIES = {
  seating: "Seating",
  tables: "Tables",
  storage: "Storage",
  lighting: "Lighting",
  objects: "Objects",
};

const ERAS = {
  contemporary: { name: "Contemporary", title: "Contemporary" },
  antique: { name: "Antique", title: "Antiques" },
};

const DELIVERY_ZONES = [
  { name: "East", digits: "0123", fees: { parcel: 35, "white-glove": 250, collect: 0 } },
  { name: "Central", digits: "4567", fees: { parcel: 55, "white-glove": 450, collect: 0 } },
  { name: "West", digits: "89", fees: { parcel: 75, "white-glove": 650, collect: 0 } },
];

const DELIVERY_OPTIONS = [
  {
    id: "parcel",
    name: "Parcel",
    blurb: "Boxed, insured and tracked to your door.",
    eta: "3 to 5 working days",
    unavailableWhen: "needsWhiteGlove",
    reason: "Some pieces in your bag need white-glove delivery.",
  },
  {
    id: "white-glove",
    name: "White-glove",
    blurb: "A two-person team carries it to the room you choose, unpacks it and takes the packaging away.",
    eta: "On a day that suits you, within 2 weeks",
  },
  {
    id: "collect",
    name: "Collect from the workshop",
    blurb: "Collect in person, by appointment.",
    eta: "Ready in 2 working days",
  },
];

const PAYMENT_OPTIONS = [
  {
    id: "bank-transfer",
    name: "Bank transfer",
    blurb: "Our bank details arrive with your order confirmation.",
    instructions: "Transfer the amount due today within five working days, quoting {id} as the reference.",
  },
  {
    id: "invoice",
    name: "Invoice",
    blurb: "Pay within 14 days of invoice. Popular with trade and project orders.",
    instructions: "We will email an invoice for the amount due today, payable within 14 days. Please quote {id}.",
  },
];

const TIMELINE = [
  { id: "placed", afterSeconds: 0, label: "Order placed", detail: "Thank you. Your order is in." },
  { id: "confirmed", afterSeconds: 20, label: "Confirmed", detail: "Payment is in and your pieces are reserved." },
  { id: "workshop", afterSeconds: 60, label: "In the workshop", detail: "Each piece is made or checked by hand." },
  {
    id: "dispatched",
    afterSeconds: 100,
    label: "On its way",
    detail: "Packed, insured and with our delivery team.",
    collect: { label: "Ready to collect", detail: "Packed and waiting for you at the workshop." },
  },
  {
    id: "delivered",
    afterSeconds: 150,
    label: "Delivered",
    detail: "Delivered. We hope you love it.",
    collect: { label: "Collected", detail: "Collected from the workshop. We hope you love it." },
  },
];

const CHECKOUT_FIELDS = {
  contact: { name: "Enter your name.", email: "Enter your email.", phone: "Enter a phone number." },
  address: {
    line1: "Enter a street address.",
    line2: null,
    city: "Enter a city.",
    region: "Enter a state or region.",
    postcode: "Enter a postcode.",
    country: "Enter a country.",
  },
};

const DEFAULT_STATE = {
  session: { isTrade: false },
  bag: [],
  saved: [],
  checkout: {
    contact: { name: "Robin Ashby", email: "robin.ashby@example.com", phone: "(518) 555-0147" },
    address: {
      line1: "14 Larkspur Lane",
      line2: "Apt 3",
      city: "Hudson",
      region: "NY",
      postcode: "12534",
      country: "United States",
    },
    delivery: "white-glove",
    payment: "bank-transfer",
  },
  orders: [],
  sold: [],
  recent: [],
};
