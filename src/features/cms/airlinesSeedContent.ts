export const airlinesSeedContent: Record<string, any> = {
hero: {
  title: "Airline Information Hub",
  subtitle:
    "Browse airlines worldwide, find baggage rules and contact details",
},
airlines: [
  {
    name: "Emirates",
    iata: "EK",
    icao: "EK",
    country: "United Arab Emirates",
    countryCode: "AE",
    flag: "",
    website: "emirates.com",
    introduction:
      "Emirates is the flag carrier of the United Arab Emirates, operating scheduled services to more than 100 destinations across six continents.",
    sections: [
      {
        title: "Frequent flyer",
        content:
          "Emirates Skywards earns Miles on every flight, redeemable for flights, upgrades and partner rewards.",
      },
    ],
    baggage: {
      summary:
        "One cabin bag (max 7 kg) plus one personal item is permitted in the cabin. Checked baggage allowance depends on the route and fare class.",
      allowances: [
        { title: "Cabin baggage", content: "Up to 7 kg, 55 x 40 x 20 cm" },
        { title: "Personal item", content: "Handbag or laptop bag fitting under the seat in front" },
      ],
    },
    tips: [
      "Check in online from 24 hours before departure.",
      "Emirates departs from Terminal 3 at Dubai International (DXB).",
    ],
  },
  {
    name: "Qatar Airways",
    iata: "QR",
    icao: "QR",
    country: "Qatar",
    countryCode: "QA",
    flag: "",
    website: "qatarairways.com",
    introduction: "Qatar Airways is the state-owned flag carrier of Qatar, serving over 150 destinations worldwide via its Doha hub.",
    sections: [
      {
        title: "Frequent flyer",
        content: "Earn and redeem Qmiles on Qatar Airways flights and its worldwide partner network.",
      },
    ],
    baggage: {
      summary: "A carry-on of 7 kg plus a personal item is allowed. Checked baggage allowances vary by route.",
      allowances: [
        { title: "Cabin baggage", content: "7 kg, 50 x 40 x 20 cm" },
        { title: "Checked baggage", content: "20–30 kg on most routes, route dependent." },
      ],
    },
    tips: ["Doha Hamad International (DOH) is the main hub."],
  },
  {
    name: "Singapore Airlines",
    iata: "SQ",
    icao: "SQ",
    country: "Singapore",
    countryCode: "SG",
    flag: "",
    website: "singaporeair.com",
    introduction:
      "Singapore Airlines, the flag carrier of Singapore, is widely recognised for its service and the Kris Flyer loyalty programme.",
    sections: [
      {
        title: "Frequent flyer",
        content: "KrisFlyer Miles can be earned and redeemed on Singapore Airlines and its partners.",
      },
    ],
    baggage: {
      summary:
        "One carry-on (7 kg) and one personal item are permitted in the cabin. Checked allowances differ by route and class.",
      allowances: [
        { title: "Cabin baggage", content: "7 kg, 56 x 40 x 23 cm" },
        { title: "Checked baggage", content: "Economy 20–30 kg; Suites/Business vary by route." },
      ],
    },
    tips: ["Singapore Changi (SIN) is a frequent World's Best Airport winner."],
  },
  {
    name: "Cathay Pacific",
    iata: "CX",
    icao: "CPA",
    country: "Hong Kong",
    countryCode: "HK",
    flag: "",
    website: "cathaypacific.com",
    introduction: "Cathay Pacific is Hong Kong's flag carrier, serving routes across Asia, the Americas, Oceania and Europe.",
    sections: [
      {
        title: "Frequent flyer",
        content: "Asia Miles can be earned and redeemed on Cathay Pacific and partner airlines.",
      },
    ],
    baggage: {
      summary:
        "A carry-on of 7 kg plus a personal item is permitted. Checked baggage depends on the fare and route.",
      allowances: [
        { title: "Cabin baggage", content: "7 kg, 56 x 36 x 23 cm" },
        { title: "Checked baggage", content: "30 kg on most routes; route dependent." },
      ],
    },
    tips: ["Hong Kong International (HKG) is the primary hub."],
  },
  {
    name: "Thai Airways",
    iata: "TG",
    icao: "THA",
    country: "Thailand",
    countryCode: "TH",
    flag: "🇹🇭",
    website: "thaia.com",
    introduction:
      "Thai Airways is the national airline of Thailand, operating flights to destinations across Asia, Europe, Oceania and the Middle East.",
    sections: [
      {
        title: "Baggage policy",
        content:
          "Carry-on weighing up to 7 kg plus personal effects is permitted. Checked baggage allowances vary by route and class.",
      },
    ],
    baggage: {
      summary:
        "Carry-on allowance is up to 7 kg. Checked baggage depends on the booked route and class.",
      allowances: [
        { title: "Cabin baggage", content: "7 kg, 56 x 40 x 23 cm" },
        { title: "Checked baggage", content: "20–30 kg depending on route/class." },
      ],
    },
    tips: ["Suvarnabhumi (BKK) and Don Mueang (DMK) serve Bangkok."],
  },
  {
    name: "Lufthansa",
    iata: "LH",
    icao: "DLH",
    country: "Germany",
    countryCode: "DE",
    flag: "🇩🇪",
    website: "lufthansa.com",
    introduction:
      "Lufthansa is Germany's flag carrier and a founding member of Star Alliance, flying to over 300 destinations.",
    sections: [
      {
        title: "Frequent flyer",
        content: "Miles & More lets you collect and redeem miles on Lufthansa and partner airlines.",
      },
    ],
    baggage: {
      summary:
        "One piece of hand luggage (max 8 kg) is permitted. Checked baggage allowances depend on the fare and route.",
      allowances: [
        { title: "Cabin baggage", content: "8 kg, 55 x 40 x 23 cm" },
        { title: "Checked baggage", content: "20–30 kg, varies by route/class." },
      ],
    },
    tips: ["Frankfurt (FRA) and Munich (MUC) are Lufthansa's main hubs."],
  },
  {
    name: "British Airways",
    iata: "BA",
    icao: "BAW",
    country: "United Kingdom",
    countryCode: "GB",
    flag: "🇬🇧",
    website: "britishairways.com",
    introduction:
      "British Airways is the UK's flag carrier, part of the International Airlines Group, serving over 350 destinations.",
    sections: [
      {
        title: "Frequent flyer",
        content: "Avios can be earned and redeemed on British Airways and partner flights.",
      },
    ],
    baggage: {
      summary:
        "Hand luggage allowance is one item up to 23 kg (cabin dependent). Checked baggage depends on the ticket.",
      allowances: [
        { title: "Cabin baggage", content: "23 kg, 56 x 45 x 25 cm" },
        { title: "Checked baggage", content: "23–34 kg depending on class/route." },
      ],
    },
    tips: ["London Heathrow (LHR) and London Gatwick (LGW) are key hubs."],
  },
  {
    name: "Air France",
    iata: "AF",
    icao: "AFR",
    country: "France",
    countryCode: "FR",
    flag: "🇫🇷",
    website: "airfrance.com",
    introduction:
      "Air France is the national airline of France and a founding member of SkyTeam, flying to 200+ destinations.",
    sections: [
      {
        title: "Frequent flyer",
        content:
          "Flying Blue is shared with KLM and Delta, earning miles on all three carriers.",
      },
    ],
    baggage: {
      summary:
        "One cabin bag (max 12 kg) plus a personal item is permitted. Checked baggage depends on the route and fare.",
      allowances: [
        { title: "Cabin baggage", content: "12 kg, 55 x 35 x 25 cm" },
        { title: "Checked baggage", content: "20–30 kg, varies by route/class." },
      ],
    },
    tips: ["Paris-Charles de Gaulle (CDG) is the main hub."],
  },
  {
    name: "Delta Air Lines",
    iata: "DL",
    icao: "DAL",
    country: "United States",
    countryCode: "US",
    flag: "🇺🇸",
    website: "delta.com",
    introduction:
      "Delta Air Lines is a founding member of SkyTeam, serving six continents from its Atlanta hub.",
    sections: [
      {
        title: "Frequent flyer",
        content:
          "SkyMiles members earn miles on Delta and partner airlines with no expiry when earning or redeeming within 24 months.",
      },
    ],
    baggage: {
      summary:
        "A carry-on (22 x 14 x 9 in) and one personal item are allowed. Checked baggage allowances vary by route and status.",
      allowances: [
        { title: "Carry-on", content: "56 x 36 x 23 cm plus a personal item" },
        { title: "Checked baggage", content: "20–32 kg depending on route/class." },
      ],
    },
    tips: ["Atlanta Hartsfield-Jackson (ATL) is Delta's largest hub."],
  },
  {
    name: "KLM",
    iata: "KL",
    icao: "KLM",
    country: "Netherlands",
    countryCode: "NL",
    flag: "",
    website: "klm.com",
    introduction:
      "KLM is the national airline of the Netherlands and the oldest airline still operating under its original name.",
    sections: [
      {
        title: "Frequent flyer",
        content:
          "Flying Blue, shared with Air France and Delta, lets you earn and redeem miles across the three carriers.",
      },
    ],
    baggage: {
      summary:
        "Carry-on allowance is up to 12 kg. Checked baggage depends on the booked fare and route.",
      allowances: [
        { title: "Cabin baggage", content: "12 kg, 55 x 40 x 25 cm" },
        { title: "Checked baggage", content: "20–30 kg, route/class dependent." },
      ],
    },
    tips: ["Amsterdam Schiphol (AMS) is KLM's home base."],
  },
  {
    name: "Turkish Airlines",
    iata: "TK",
    icao: "THY",
    country: "Turkey",
    countryCode: "TR",
    flag: "🇹🇷",
    website: "thy.com",
    introduction:
      "Turkish Airlines is Turkey's flag carrier and one of the world's most geographically extensive route networks.",
    sections: [
      {
        title: "Frequent flyer",
        content:
          "Miles&Smiles lets you collect and redeem miles across Turkish Airlines and its Star Alliance partners.",
      },
    ],
    baggage: {
      summary:
        "Free cabin baggage allowance and checked baggage vary by route. Check the latest rules before you fly.",
      allowances: [
        { title: "Cabin baggage", content: "8 kg, 55 x 40 x 23 cm" },
        { title: "Checked baggage", content: "20–32 kg, route dependent." },
      ],
    },
    tips: ["Istanbul Airport (IST) is Turkish Airlines' primary hub."],
  },
],
};
