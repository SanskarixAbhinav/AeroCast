// WeatherGPT Frontend Logic - Vanilla JS (<500 lines)
(function () {
  'use strict';

  // --- 1. Multilingual Dictionaries ---
  const I18N = {
    en: {
      title: "WeatherGPT", subtitle: "AI Weather & Farming Advisory",
      placeholder: "Ask about weather, rain, spraying, irrigation...",
      cyclone: "Simulate cyclone", tts: "Read aloud", thinking: "WeatherGPT is thinking...",
      emptyT: "Weather Insights & Advisories", emptyD: "Ask a question to see conditions, farming decisions & map.",
      sevenDay: "7-Day Outlook", mapT: "📍 Location Map",
      disclaimer: "Advisories are based on forecast thresholds, not official government warnings.",
      retry: "Retry", timeout: "Weather request timed out. Please retry.",
      networkErr: "Unable to connect to weather service. Please retry.",
      voiceHint: "Voice input works best in Google Chrome.",
      chips: ["Will it rain tomorrow in Kolkata?", "Is it safe to spray pesticides in Kolkata tomorrow?", "7-day forecast for Chennai", "How much rain did Mumbai get last July?", "Any cyclone near Kolkata?"]
    },
    hi: {
      title: "वेदर जीपीटी (WeatherGPT)", subtitle: "कृषि और मौसम सलाह सहायक",
      placeholder: "मौसम, बारिश, छिड़काव या सिंचाई के बारे में पूछें...",
      cyclone: "चक्रवात सिमुलेशन", tts: "आवाज में सुनें", thinking: "वेदर जीपीटी सोच रहा है...",
      emptyT: "मौसम विवरण और कृषि सलाह", emptyD: "मौसम का सवाल पूछें और यहाँ लाइव स्थिति व नक्शा देखें।",
      sevenDay: "7 दिनों का पूर्वानुमान", mapT: "📍 स्थान का नक्शा",
      disclaimer: "सलाह पूर्वानुमान सीमाओं पर आधारित है, आधिकारिक चेतावनी नहीं।",
      retry: "पुनः प्रयास करें", timeout: "अनुरोध समय समाप्त। कृपया पुनः प्रयास करें।",
      networkErr: "मौसम सेवा से संपर्क नहीं हो सका। कृपया पुनः प्रयास करें।",
      voiceHint: "वॉइस इनपुट गूगल क्रोम में सबसे अच्छा काम करता है।",
      chips: ["क्या कल कोलकाता में बारिश होगी?", "क्या कल कोलकाता में कीटनाशक छिड़कना सुरक्षित है?", "चेन्नई का 7 दिनों का मौसम पूर्वानुमान", "मुंबई में पिछले जुलाई में कितनी बारिश हुई थी?", "क्या कोलकाता के पास कोई चक्रवात है?"]
    },
    bn: {
      title: "ওয়েদার জিপিটি (WeatherGPT)", subtitle: "কৃষি ও আবহাওয়া পরামর্শ সহকারী",
      placeholder: "আবহাওয়া, বৃষ্টি বা স্প্রে করার ব্যাপারে জিজ্ঞাসা করুন...",
      cyclone: "ঘূর্ণিঝড় ডেমো", tts: "উচ্চস্বরে পড়ুন", thinking: "ওয়েদার জিপিটি ভাবছে...",
      emptyT: "আবহাওয়ার তথ্য ও কৃষি পরামর্শ", emptyD: "প্রশ্ন জিজ্ঞাসা করে লাইভ আবহাওয়া ও পরামর্শ দেখুন।",
      sevenDay: "৭ দিনের পূর্বাভাস", mapT: "📍 স্থানের মানচিত্র",
      disclaimer: "পরামর্শ পূর্বাভাসের উপর নির্ভরশীল, সরকারি সতর্কতা নয়।",
      retry: "পুনরায় চেষ্টা করুন", timeout: "অনুরোধের সময় শেষ। দয়া করে আবার চেষ্টা করুন।",
      networkErr: "সার্ভারে সংযোগ করা যায়নি। ইন্টারনেট সংযোগ পরীক্ষা করুন।",
      voiceHint: "ভয়েস ইনপুট ক্রোম ব্রাউজারে সবচেয়ে ভালো কাজ করে।",
      chips: ["কলকাতায় কি কাল বৃষ্টি হবে?", "কলকাতায় কাল কীটনাশক স্প্রে করা কি নিরাপদ?", "চেন্নাইয়ের ৭ দিনের আবহাওয়ার পূর্বাভাস", "গত জুলাইয়ে মুম্বাইতে কত বৃষ্টি হয়েছিল?", "কলকাতার কাছে কি কোনো ঘূর্ণিঝড় আছে?"]
    },
    ta: {
      title: "வெதர் ஜிபிடி (WeatherGPT)", subtitle: "வானிலை மற்றும் விவசாய ஆலோசனை",
      placeholder: "மழை, பூச்சிக்கொல்லி தெளிப்பு பற்றி கேட்கவும்...",
      cyclone: "புயல் மாதிரி", tts: "குரலில் வாசி", thinking: "பதிலளிக்கிறது...",
      emptyT: "வானிலை மற்றும் விவசாய பரிந்துரைகள்", emptyD: "கேள்விகளைக் கேட்டு நேரலை வானிலை மற்றும் வரைபடத்தைப் பார்க்கவும்.",
      sevenDay: "7 நாள் முன்னறிவிப்பு", mapT: "📍 இருப்பிட வரைபடம்",
      disclaimer: "ஆலோசனைகள் முன்னறிவிப்பின் அடிப்படையிலானவை, அரசு எச்சரிக்கை அல்ல.",
      retry: "மீண்டும் முயற்சிக்கவும்", timeout: "நேரம் முடிந்தது. மீண்டும் முயற்சிக்�  // --- 2. Mock Responses (CONFIG.USE_MOCK) ---
  const PLACES = [
    ["Kolkata", "Kolkata, West Bengal, India", 22.57, 88.36, /kolkata|calcutta|कलकत्ता|कोलकाता|কলকাতা|கொல்கத்தா|కోల్‌కతా/i],
    ["Mumbai", "Mumbai, Maharashtra, India", 19.07, 72.87, /mumbai|bombay|बम्बई|मुंबई|মুম্বাই|மும்பை|ముంబై/i],
    ["Delhi", "Delhi, India", 28.61, 77.21, /delhi|new\s*delhi|दिल्ली|দিল্লি|டெல்லி|దిల్లీ/i],
    ["Chennai", "Chennai, Tamil Nadu, India", 13.08, 80.27, /chennai|madras|चेन्नई|சென்னை|చెన్నై|চেন্নাই/i],
    ["Bengaluru", "Bengaluru, Karnataka, India", 12.97, 77.59, /bengaluru|bangalore|बेंगलुरु|பெங்களூரு|బెంగళూరు/i],
    ["Hyderabad", "Hyderabad, Telangana, India", 17.38, 78.48, /hyderabad|हैदराबाद|হায়দ্রাবাদ|ஹைதராபாத்|హైదరాబాద్/i],
    ["Ahmedabad", "Ahmedabad, Gujarat, India", 23.02, 72.57, /ahmedabad|अहमदाबाद|அகமதாபாத்/i],
    ["Pune", "Pune, Maharashtra, India", 18.52, 73.85, /pune|पुणे|புனே/i],
    ["Jaipur", "Jaipur, Rajasthan, India", 26.91, 75.79, /jaipur|जयपुर|ஜெய்ப்பூர்/i],
    ["Lucknow", "Lucknow, Uttar Pradesh, India", 26.84, 80.94, /lucknow|लखनऊ|லக்னோ/i],
    ["Patna", "Patna, Bihar, India", 25.59, 85.13, /patna|पटना|பாட்னா/i],
    ["Bhopal", "Bhopal, Madhya Pradesh, India", 23.25, 77.41, /bhopal|भोपाल|போபால்/i],
    ["Chandigarh", "Chandigarh, Punjab, India", 30.73, 76.78, /chandigarh|चंडीगढ़|சண்டிகர்/i],
    ["Kochi", "Kochi, Kerala, India", 9.93, 76.26, /kochi|cochin|कोच्चि|கொச்சி/i],
    ["Guwahati", "Guwahati, Assam, India", 26.14, 91.73, /guwahati|गुवाहाटी|கவுகாத்தி/i],
    ["Bhubaneswar", "Bhubaneswar, Odisha, India", 20.29, 85.82, /bhubaneswar|भुवनेश्वर|புவனேஸ்வர்/i],
    ["Shimla", "Shimla, Himachal Pradesh, India", 31.10, 77.17, /shimla|शिमला|சிம்லா/i],
    ["Srinagar", "Srinagar, Jammu and Kashmir, India", 34.08, 74.79, /srinagar|श्रीनगर|ஸ்ரீநகர்/i],
    ["Goa", "Panaji, Goa, India", 15.49, 73.82, /goa|गोवा|கோவா/i]
  ].map(([name, label, lat, lon, match]) => ({ name, label, lat, lon, match }));

  const getRainAlerts = (mm, d) => mm >= 115.6
    ? [{ type: "very_heavy_rain", level: "red", date: d, message: `Very heavy rain expected (${mm} mm).`, simulated: false, official: false }]
    : (mm >= 64.5 ? [{ type: "heavy_rain", level: "orange", date: d, message: `Heavy rain expected (${mm} mm).`, simulated: false, official: false }] : []);

  function getMock(q, lang, demo) {
    const qL = (q || "").toLowerCase().trim();
    const now = new Date().toISOString();
    const tmrw = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
    const isWeather = /weather|rain|forecast|temp|temperature|spray|pesticide|harvest|irrigate|irrigation|cyclone|storm|wind|humidity|shower|climate|7-day|july|history|past|मौसम|बारिश|तापमान|कीटनाशक|सिंचाई|फसल|चक्रवात|पूर्वानुमान|হাওয়া|বৃষ্টি|স্প্রে|কীটনাশক|সেচ|ঘূর্ণিঝড়|পূর্বাভাস|வானிலை|மழை|தெளிப்பு|பூச்சிக்கொல்லி|பாசனம்|புயல்|முன்னறிவிப்பு|వాతావరణం|వర్షం|పిచికారీ|పురుగుమందు|సాగునీరు|తుఫాను|సూచన|हवामान|पाऊस|फवारणी|कीटकनाशक|सिंचन|चक्रीवादळ|अंदाज/i.test(qL) || demo === "cyclone";

    let loc = null;
    for (const p of PLACES) { if (p.match.test(qL)) { loc = p; break; } }
    const prepMatch = qL.match(/\b(?:in|for|at|near|of)\s+([a-zA-Z\u0080-\uFFFF]+)\b/i);
    const hasUnrecognizedPlace = prepMatch && !/tomorrow|today|yesterday|week|july|spray|pesticide|harvest|irrigation|cyclone|weather|forecast|rain|me|us|the|a|an|this|next/i.test(prepMatch[1]) && !loc;

    if ((!isWeather && !loc) || hasUnrecognizedPlace) {
      return { answer: "Please tell me which city or place you mean", facts: null, alerts: [], meta: { source: "Open-Meteo", fetched_at: now, from_cache: false, stale: false } };
    }
    if (!loc) loc = PLACES[0];

    if (demo === "cyclone" || /cyclone|storm|चक्रवात|ঘূর্ণিঝড়|புயல்|తుఫాను|चक्रीवादळ/i.test(qL)) {
      const basin = loc.lon > 80 ? "Bay of Bengal" : "Arabian Sea";
      return {
        answer: `A severe cyclonic storm 'Cyclone DEMO' is active over the ${basin} with winds reaching 110 km/h near ${loc.name}. Coastal fishermen are advised not to venture into the sea.`,
        facts: {
          topic: "cyclone", location: loc.label, lat: loc.lat, lon: loc.lon, stale: false,
          day: { date: tmrw, temp_max: 29, temp_min: 24, rain_mm: 85, rain_prob: 90, wind_max_kmh: 65, gust_max_kmh: 95, et0_mm: 2 },
          cyclone: { name: "Cyclone DEMO", basin, category: "Severe Cyclonic Storm", max_wind_kmh: 110, landfall_estimate: "Coastal area in 36h", advisory: "Fishermen should not go to sea.", simulated: true }
        },
        alerts: [{ type: "cyclone", level: "red", date: tmrw, message: "SIMULATED: Cyclone DEMO. Max wind 110 km/h.", simulated: true, official: false }],
        meta: { source: "Open-Meteo", fetched_at: now, from_cache: false, stale: false }
      };
    }

    if (/spray|pesticide|कीटनाशक|কীটনাশক|பூச்சிக்கொல்லி|పురుగుమందు|फवारणी/i.test(qL)) {
      return {
        answer: `Spraying pesticides in ${loc.name} tomorrow is not advisable due to expected rain and wind speeds exceeding 15 km/h.`,
        facts: {
          topic: "spray", location: loc.label, lat: loc.lat, lon: loc.lon, stale: false,
          day: { date: tmrw, temp_max: 31, temp_min: 25, rain_mm: 22, rain_prob: 75, wind_max_kmh: 24, gust_max_kmh: 42, et0_mm: 3.2 },
          flags: { spray_safe: false, reason: ["rain likely", "wind>15"], window: `${tmrw}T06:00 to ${tmrw}T18:00`, max_rain_prob: 75, max_wind_kmh: 24, max_temp_c: 31 }
        },
        alerts: getRainAlerts(22, tmrw), meta: { source: "Open-Meteo", fetched_at: now, from_cache: false, stale: false }
      };
    }

    if (/forecast|7-day|पूर्वानुमान|পূর্বাভাস|முன்னறிவிப்பு|సూచన|अंदाज/i.test(qL)) {
      const daily = [];
      for (let i = 0; i < 7; i++) {
        daily.push({
          date: new Date(Date.now() + i * 864e5).toISOString().slice(0, 10),
          temp_max: 33 - (i % 3), temp_min: 26 - (i % 2),
          rain_mm: (i % 2 === 0) ? 12 : 2, rain_prob: (i % 2 === 0) ? 65 : 20,
          wind_max_kmh: 18 + i, gust_max_kmh: 30 + i, et0_mm: 4.2
        });
      }
      return {
        answer: `${loc.name} will see warm temperatures around 26-33 C with moderate showers on alternate days over the next 7 days.`,
        facts: { topic: "forecast", location: loc.label, lat: loc.lat, lon: loc.lon, stale: false, day: daily[0], daily: daily },
        alerts: [], meta: { source: "Open-Meteo", fetched_at: now, from_cache: true, stale: false }
      };
    }

    if (/july|history|past|गेल्या|கடந்த|గత|গত|पिछले/i.test(qL)) {
      return {
        answer: `${loc.name} recorded 640 mm of total rain between 2026-07-01 and 2026-07-31, with an average max temperature of 31.2 C. The rainiest day had 120 mm.`,
        facts: {
          topic: "history", location: loc.label, lat: loc.lat, lon: loc.lon, stale: false,
          history: { start: "2026-07-01", end: "2026-07-31", total_rain_mm: 640, avg_temp_max: 31.2, rainiest_day: { date: "2026-07-18", rain_mm: 120 } }
        },
        alerts: [], meta: { source: "Open-Meteo archive", fetched_at: now, from_cache: true, stale: false }
      };
    }

    let rainMm = 18;
    const rMatch = qL.match(/rain_mm\s*[:=]\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*mm\b|rain(?:fall)?\s*(?:of|is|:|=)?\s*(\d+(?:\.\d+)?)/i);
    const parsed = rMatch ? parseFloat(rMatch[1] || rMatch[2] || rMatch[3]) : NaN;
    if (!isNaN(parsed)) {
      rainMm = parsed;
    } else if (/heavy\s*rain|भारी\s*बारिश|ভারী\s*বৃষ্টি|கனமழை|భారీ\s*వర్షం|मुसळधार\s*पाऊस/i.test(qL)) {
      rainMm = 70;
    }

    return {
      answer: `${loc.name} tomorrow: temperatures 26-32 C, ${rainMm} mm rain (${rainMm >= 64.5 ? 85 : 70}% probability), wind up to 22 km/h.`,
      facts: {
        topic: "rain", location: loc.label, lat: loc.lat, lon: loc.lon, stale: false,
        current: { time: now, temperature_2m: 30.5, relative_humidity_2m: 76, precipitation: 0, wind_speed_10m: 14, wind_gusts_10m: 26 },
        day: { date: tmrw, temp_max: 32, temp_min: 26, rain_mm: rainMm, rain_prob: rainMm >= 64.5 ? 85 : 70, wind_max_kmh: 22, gust_max_kmh: 40, et0_mm: 3.5 },
        flags: { irrigate: false, reason: ["enough rain expected in next 2 days"], rain_next_2_days_mm: rainMm + 7, et0_mm: 3.5 }
      },
      alerts: getRainAlerts(rainMm, tmrw),
      meta: { source: "Open-Meteo", fetched_at: now, from_cache: false, stale: false }
    };
  }     alerts.push({ type: "very_heavy_rain", level: "red", date, message: `Very heavy rain expected (${rainMm} mm).`, simulated: false, official: false });
    } else if (rainMm >= 64.5) {
      alerts.push({ type: "heavy_rain", level: "orange", date, message: `Heavy rain expected (${rainMm} mm).`, simulated: false, official: false });
    }
    return alerts;
  }

  function getMock(q, lang, demo) {
    const qL = (q || "").toLowerCase().trim();
    const now = new Date().toISOString();
    const tmrw = new Date(Date.now() + 864e5).toISOString().slice(0, 10);

    const isWeather = /weather|rain|forecast|temp|temperature|spray|pesticide|harvest|irrigate|irrigation|cyclone|storm|wind|humidity|shower|climate|7-day|july|history|past|मौसम|बारिश|तापमान|कीटनाशक|सिंचाई|फसल|चक्रवात|पूर्वानुमान|হাওয়া|বৃষ্টি|স্প্রে|কীটনাশক|সেচ|ঘূর্ণিঝড়|পূর্বাভাস|வானிலை|மழை|தெளிப்பு|பூச்சிக்கொல்லி|பாசனம்|புயல்|முன்னறிவிப்பு|వాతావరణం|వర్షం|పిచికారీ|పురుగుమందు|సాగునీరు|తుఫాను|సూచన|हवामान|पाऊस|फवारणी|कीटकनाशक|सिंचन|चक्रीवादळ|अंदाज/i.test(qL) || demo === "cyclone";

    let loc = null;
    for (const p of PLACES) {
      if (p.match.test(qL)) { loc = p; break; }
    }

    const prepMatch = qL.match(/\b(?:in|for|at|near|of)\s+([a-zA-Z\u0080-\uFFFF]+)\b/i);
    const hasUnrecognizedPlace = prepMatch && !/tomorrow|today|yesterday|week|july|spray|pesticide|harvest|irrigation|cyclone|weather|forecast|rain|me|us|the|a|an|this|next/i.test(prepMatch[1]) && !loc;

    if ((!isWeather && !loc) || hasUnrecognizedPlace) {
      return {
        answer: "Please tell me which city or place you mean",
        facts: null,
        alerts: [],
        meta: { source: "Open-Meteo", fetched_at: now, from_cache: false, stale: false }
      };
    }

    if (!loc) loc = PLACES[0];

    if (demo === "cyclone" || /cyclone|storm|चक्रवात|ঘূর্ণিঝড়|புயல்|తుఫాను|चक्रीवादळ/i.test(qL)) {
      const basin = loc.lon > 80 ? "Bay of Bengal" : "Arabian Sea";
      return {
        answer: `A severe cyclonic storm 'Cyclone DEMO' is active over the ${basin} with winds reaching 110 km/h near ${loc.name}. Coastal fishermen are advised not to venture into the sea.`,
        facts: {
          topic: "cyclone", location: loc.label, lat: loc.lat, lon: loc.lon, stale: false,
          day: { date: tmrw, temp_max: 29, temp_min: 24, rain_mm: 85, rain_prob: 90, wind_max_kmh: 65, gust_max_kmh: 95, et0_mm: 2 },
          cyclone: { name: "Cyclone DEMO", basin: basin, category: "Severe Cyclonic Storm", max_wind_kmh: 110, landfall_estimate: "Coastal area in 36h", advisory: "Fishermen should not go to sea.", simulated: true }
        },
        alerts: [{ type: "cyclone", level: "red", date: tmrw, message: "SIMULATED: Cyclone DEMO. Max wind 110 km/h.", simulated: true, official: false }],
        meta: { source: "Open-Meteo", fetched_at: now, from_cache: false, stale: false }
      };
    }

    if (/spray|pesticide|कीटनाशक|কীটনাশক|பூச்சிக்கொல்லி|పురుగుమందు|फवारणी/i.test(qL)) {
      return {
        answer: `Spraying pesticides in ${loc.name} tomorrow is not advisable due to expected rain and wind speeds exceeding 15 km/h.`,
        facts: {
          topic: "spray", location: loc.label, lat: loc.lat, lon: loc.lon, stale: false,
          day: { date: tmrw, temp_max: 31, temp_min: 25, rain_mm: 22, rain_prob: 75, wind_max_kmh: 24, gust_max_kmh: 42, et0_mm: 3.2 },
          flags: { spray_safe: false, reason: ["rain likely", "wind>15"], window: `${tmrw}T06:00 to ${tmrw}T18:00`, max_rain_prob: 75, max_wind_kmh: 24, max_temp_c: 31 }
        },
        alerts: getRainAlerts(22, tmrw),
        meta: { source: "Open-Meteo", fetched_at: now, from_cache: false, stale: false }
      };
    }

    if (/forecast|7-day|पूर्वानुमान|পূর্বাভাস|முன்னறிவிப்பு|సూచన|अंदाज/i.test(qL)) {
      const daily = [];
      for (let i = 0; i < 7; i++) {
        daily.push({
          date: new Date(Date.now() + i * 864e5).toISOString().slice(0, 10),
          temp_max: 33 - (i % 3), temp_min: 26 - (i % 2),
          rain_mm: (i % 2 === 0) ? 12 : 2, rain_prob: (i % 2 === 0) ? 65 : 20,
          wind_max_kmh: 18 + i, gust_max_kmh: 30 + i, et0_mm: 4.2
        });
      }
      return {
        answer: `${loc.name} will see warm temperatures around 26-33 C with moderate showers on alternate days over the next 7 days.`,
        facts: { topic: "forecast", location: loc.label, lat: loc.lat, lon: loc.lon, stale: false, day: daily[0], daily: daily },
        alerts: [], meta: { source: "Open-Meteo", fetched_at: now, from_cache: true, stale: false }
      };
    }

    if (/july|history|past|गेल्या|கடந்த|గత|গত|पिछले/i.test(qL)) {
      return {
        answer: `${loc.name} recorded 640 mm of total rain between 2026-07-01 and 2026-07-31, with an average max temperature of 31.2 C. The rainiest day had 120 mm.`,
        facts: {
          topic: "history", location: loc.label, lat: loc.lat, lon: loc.lon, stale: false,
          history: { start: "2026-07-01", end: "2026-07-31", total_rain_mm: 640, avg_temp_max: 31.2, rainiest_day: { date: "2026-07-18", rain_mm: 120 } }
        },
        alerts: [], meta: { source: "Open-Meteo archive", fetched_at: now, from_cache: true, stale: false }
      };
    }

    let rainMm = 18;
    const rMatch = qL.match(/rain_mm\s*[:=]\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*mm\b|rain(?:fall)?\s*(?:of|is|:|=)?\s*(\d+(?:\.\d+)?)/i);
    const parsed = rMatch ? parseFloat(rMatch[1] || rMatch[2] || rMatch[3]) : NaN;
    if (!isNaN(parsed)) {
      rainMm = parsed;
    } else if (/heavy\s*rain|भारी\s*बारिश|ভারী\s*বৃষ্টি|கனமழை|భారీ\s*వర్షం|मुसळधार\s*पाऊस/i.test(qL)) {
      rainMm = 70;
    }

    return {
      answer: `${loc.name} tomorrow: temperatures 26-32 C, ${rainMm} mm rain (${rainMm >= 64.5 ? 85 : 70}% probability), wind up to 22 km/h.`,
      facts: {
        topic: "rain", location: loc.label, lat: loc.lat, lon: loc.lon, stale: false,
        current: { time: now, temperature_2m: 30.5, relative_humidity_2m: 76, precipitation: 0, wind_speed_10m: 14, wind_gusts_10m: 26 },
        day: { date: tmrw, temp_max: 32, temp_min: 26, rain_mm: rainMm, rain_prob: rainMm >= 64.5 ? 85 : 70, wind_max_kmh: 22, gust_max_kmh: 40, et0_mm: 3.5 },
        flags: { irrigate: false, reason: ["enough rain expected in next 2 days"], rain_next_2_days_mm: rainMm + 7, et0_mm: 3.5 }
      },
      alerts: getRainAlerts(rainMm, tmrw),
      meta: { source: "Open-Meteo", fetched_at: now, from_cache: false, stale: false }
    };
  }

  // --- 3. Speech Audio (TTS & Voice Input) ---
  function speak(text) {
    if (!('speechSynthesis' in window) || !text) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = LOCALES[currentLang] || "en-IN";
    u.rate = 0.95;
    window.speechSynthesis.speak(u);
  }

  function initMic() {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    const micBtn = $('micBtn');
    if (!SpeechRec) {
      if (micBtn) micBtn.style.display = 'none';
      if ($('voiceHint')) $('voiceHint').textContent = I18N[currentLang]?.voiceHint || '';
      return;
    }
    speechRec = new SpeechRec();
    speechRec.continuous = false;
    speechRec.onstart = () => { micBtn.classList.add('listening'); micBtn.setAttribute('aria-label', 'Listening...'); };
    speechRec.onresult = (e) => { $('chatInput').value = e.results[0][0].transcript; };
    speechRec.onerror = () => { micBtn.classList.remove('listening'); };
    speechRec.onend = () => {
      micBtn.classList.remove('listening');
      micBtn.setAttribute('aria-label', 'Voice input');
      if ($('chatInput').value.trim() && !isPending) sendMsg($('chatInput').value.trim());
    };
    micBtn.addEventListener('click', () => {
      if (isPending) return;
      speechRec.lang = LOCALES[currentLang] || 'en-IN';
      try { speechRec.start(); } catch (_e) { speechRec.stop(); }
    });
  }

  // --- 4. Leaflet Map ---
  function renderMap(lat, lon, label) {
    if (!window.L || !lat || !lon) return;
    try {
      $('mapWrapper').style.display = 'flex';
      if (!mapInstance) {
        mapInstance = window.L.map('weatherMap', { zoomControl: true, scrollWheelZoom: false }).setView([lat, lon], 10);
        window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap', maxZoom: 18 }).addTo(mapInstance);
        markerInstance = window.L.marker([lat, lon]).addTo(mapInstance).bindPopup(label).openPopup();
      } else {
        mapInstance.setView([lat, lon], 10);
        if (markerInstance) { markerInstance.setLatLng([lat, lon]).setPopupContent(label).openPopup(); }
        else { markerInstance = window.L.marker([lat, lon]).addTo(mapInstance).bindPopup(label).openPopup(); }
      }
      mapInstance.invalidateSize();
      setTimeout(() => { if (mapInstance) mapInstance.invalidateSize(); }, 150);
    } catch (_err) { $('mapWrapper').style.display = 'none'; }
  }

  // --- 5. Message & Data Card Rendering ---
  function addBubble(role, text) {
    const row = el('div', `chat-bubble-row ${role}`);
    row.appendChild(el('div', 'bubble-meta', role === 'user' ? 'You' : 'WeatherGPT'));
    const b = el('div', 'bubble', text);
    row.appendChild(b);
    if (role === 'assistant') {
      const act = el('div', 'bubble-actions');
      const spk = el('button', 'btn-speaker');
      spk.type = 'button';
      spk.title = 'Read aloud';
      spk.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>';
      spk.onclick = () => speak(text);
      act.appendChild(spk);
      row.appendChild(act);
    }
    $('chatThread').appendChild(row);
    $('chatThread').scrollTop = $('chatThread').scrollHeight;
    return row;
  }

  function renderData(facts, alerts, meta) {
    const alertsC = $('alertsContainer');
    alertsC.innerHTML = '';
    (alerts || []).forEach(a => {
      const b = el('div', `alert-banner ${a.level || 'yellow'}`);
      if (a.simulated) b.appendChild(el('span', 'alert-tag', 'SIMULATED'));
      b.appendChild(el('span', '', a.message));
      alertsC.appendChild(b);
    });

    if (!facts) {
      $('dataCard').style.display = 'none';
      $('dataCardPlaceholder').style.display = 'flex';
      $('mapWrapper').style.display = 'none';
      return;
    }
    $('dataCardPlaceholder').style.display = 'none';
    $('dataCard').style.display = 'flex';

    $('cardLocation').textContent = facts.location || 'Location';
    const timeStr = meta?.fetched_at ? new Date(meta.fetched_at).toLocaleTimeString() : new Date().toLocaleTimeString();
    $('cardUpdated').textContent = `Updated ${timeStr} • ${meta?.source || 'Open-Meteo'}`;
    $('cardStaleBadge').style.display = (facts.stale || meta?.stale) ? 'inline-block' : 'none';

    // Cyclone
    const cyc = $('cyclonePanel');
    if (facts.cyclone) {
      cyc.style.display = 'flex'; cyc.innerHTML = '';
      const head = el('div', 'cyclone-heading');
      head.appendChild(el('span', '', `🌀 ${facts.cyclone.name} (${facts.cyclone.category || 'Storm'})`));
      head.appendChild(el('span', 'alert-tag', facts.cyclone.simulated ? 'SIMULATED' : 'ACTIVE'));
      cyc.appendChild(head);
      cyc.appendChild(el('div', 'cyclone-text', `Basin: ${facts.cyclone.basin || 'Regional'} | Max Wind: ${facts.cyclone.max_wind_kmh || 0} km/h | Landfall: ${facts.cyclone.landfall_estimate || 'Pending'}`));
      cyc.appendChild(el('div', 'cyclone-text', `Advisory: ${facts.cyclone.advisory || 'Follow official advisories.'}`));
    } else { cyc.style.display = 'none'; }

    // Flags / Verdict
    const verd = $('verdictContainer');
    if (facts.flags) {
      verd.style.display = 'flex'; verd.innerHTML = '';
      let badgeCls = 'verdict-badge', badgeTxt = '';
      if (facts.flags.spray_safe !== undefined) {
        badgeCls += facts.flags.spray_safe ? ' suitable' : ' not-advisable';
        badgeTxt = facts.flags.spray_safe ? '✅ Spraying: Suitable' : '❌ Spraying: Not Advisable';
      } else if (facts.flags.irrigate !== undefined) {
        badgeCls += facts.flags.irrigate ? ' irrigate' : ' suitable';
        badgeTxt = facts.flags.irrigate ? '💧 Irrigation: Recommended' : '✅ Irrigation: Not Needed';
      } else if (facts.flags.harvest_ok !== undefined) {
        badgeCls += facts.flags.harvest_ok ? ' suitable' : ' not-advisable';
        badgeTxt = facts.flags.harvest_ok ? '🌾 Harvesting: Suitable' : '⚠️ Harvesting: Not Advisable';
      }
      verd.appendChild(el('div', badgeCls, badgeTxt));
      if (facts.flags.reason && Array.isArray(facts.flags.reason)) {
        const rc = el('div', 'reason-chips');
        facts.flags.reason.forEach(r => rc.appendChild(el('span', 'reason-chip', r)));
        verd.appendChild(rc);
      }
    } else { verd.style.display = 'none'; }

    // Conditions
    const cond = $('currentConditions');
    if (facts.current) {
      cond.style.display = 'grid'; cond.innerHTML = '';
      const items = [
        ['Temp', `${facts.current.temperature_2m ?? '--'} °C`],
        ['Humidity', `${facts.current.relative_humidity_2m ?? '--'} %`],
        ['Wind', `${facts.current.wind_speed_10m ?? '--'} km/h`],
        ['Gusts', `${facts.current.wind_gusts_10m ?? '--'} km/h`]
      ];
      items.forEach(([l, v]) => {
        const box = el('div', 'condition-item');
        box.appendChild(el('span', 'cond-label', l));
        box.appendChild(el('span', 'cond-val', v));
        cond.appendChild(box);
      });
    } else { cond.style.display = 'none'; }

    // Day
    const day = $('daySummary');
    if (facts.day) {
      day.style.display = 'flex'; day.innerHTML = '';
      day.appendChild(el('div', 'summary-title', `📅 Forecast for ${facts.day.date}`));
      const st = el('div', 'summary-stats');
      st.appendChild(el('span', '', `🌡️ ${facts.day.temp_min}°C - ${facts.day.temp_max}°C`));
      st.appendChild(el('span', '', `🌧️ ${facts.day.rain_mm} mm (${facts.day.rain_prob ?? 0}%)`));
      st.appendChild(el('span', '', `💨 Wind: ${facts.day.wind_max_kmh} km/h`));
      day.appendChild(st);
    } else { day.style.display = 'none'; }

    // Daily strip
    const stripC = $('dailyStripContainer');
    const strip = $('dailyStrip');
    if (facts.daily && Array.isArray(facts.daily) && facts.daily.length) {
      stripC.style.display = 'flex'; strip.innerHTML = '';
      facts.daily.forEach(d => {
        const col = el('div', 'daily-col');
        col.appendChild(el('span', 'col-date', d.date.slice(5)));
        col.appendChild(el('span', 'col-icon', (d.rain_mm > 10) ? '🌧️' : (d.rain_mm > 0) ? '🌦️' : '☀️'));
        col.appendChild(el('span', 'col-temp', `${Math.round(d.temp_max)}°/${Math.round(d.temp_min)}°`));
        col.appendChild(el('span', 'col-rain', `${d.rain_mm}mm`));
        strip.appendChild(col);
      });
    } else { stripC.style.display = 'none'; }

    // History
    const hist = $('historyPanel');
    if (facts.history) {
      hist.style.display = 'flex'; hist.innerHTML = '';
      hist.appendChild(el('div', '', `📊 Rain History (${facts.history.start} to ${facts.history.end})`));
      hist.appendChild(el('div', '', `Total Rain: ${facts.history.total_rain_mm} mm | Avg Max Temp: ${facts.history.avg_temp_max} °C`));
      hist.appendChild(el('div', '', `Rainiest Day: ${facts.history.rainiest_day?.date} (${facts.history.rainiest_day?.rain_mm} mm)`));
    } else { hist.style.display = 'none'; }

    renderMap(facts.lat, facts.lon, facts.location || 'Location');
  }

  // --- 6. Send Pipeline ---
  async function sendMsg(text) {
    const q = (text || '').trim();
    if (!q || isPending) return;

    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    addBubble('user', q);
    $('chatInput').value = '';
    isPending = true;
    $('sendBtn').disabled = true;
    $('typingIndicator').style.display = 'flex';

    const payload = { q, lang: currentLang, ...(isCyclone ? { demo: 'cyclone' } : {}) };

    try {
      let data;
      if (window.CONFIG && window.CONFIG.USE_MOCK) {
        await new Promise(r => setTimeout(r, 600));
        data = getMock(q, currentLang, isCyclone ? 'cyclone' : undefined);
      } else {
        const ctrl = new AbortController();
        const tId = setTimeout(() => ctrl.abort(), 20000);
        const headers = { 'Content-Type': 'application/json' };
        if (window.CONFIG?.ANON_KEY) {
          headers['Authorization'] = `Bearer ${window.CONFIG.ANON_KEY}`;
          headers['apikey'] = window.CONFIG.ANON_KEY;
        }
        const res = await fetch(window.CONFIG.API_URL, {
          method: 'POST', headers, body: JSON.stringify(payload), signal: ctrl.signal
        });
        clearTimeout(tId);
        const json = await res.json().catch(() => null);
        if (res.status === 400 || res.status === 429) {
          addBubble('assistant', json?.error || `Error (HTTP ${res.status})`);
          return;
        }
        if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
        data = json;
      }
      if (data) {
        const ans = data.answer || 'Weather information received.';
        addBubble('assistant', ans);
        renderData(data.facts, data.alerts, data.meta);
        if (isTts) speak(ans);
      }
    } catch (err) {
      const isTime = err.name === 'AbortError';
      const msg = isTime ? (I18N[currentLang]?.timeout || I18N.en.timeout) : (I18N[currentLang]?.networkErr || I18N.en.networkErr);
      const row = addBubble('assistant', msg);
      const rBtn = el('button', 'btn-retry', I18N[currentLang]?.retry || 'Retry');
      rBtn.onclick = () => sendMsg(q);
      row.querySelector('.bubble').appendChild(document.createElement('br'));
      row.querySelector('.bubble').appendChild(rBtn);
    } finally {
      isPending = false;
      $('sendBtn').disabled = false;
      $('typingIndicator').style.display = 'none';
    }
  }

  // --- 7. Language Switcher ---
  function setLanguage(lang) {
    currentLang = lang;
    try { localStorage.setItem('weathergpt_lang', lang); } catch (_e) {}
    const t = I18N[lang] || I18N.en;
    $('ui-title').textContent = t.title;
    $('ui-subtitle').textContent = t.subtitle;
    $('ui-cyclone-label').textContent = t.cyclone;
    $('ui-tts-label').textContent = t.tts;
    $('ui-thinking').textContent = t.thinking;
    $('ui-empty-title').textContent = t.emptyT;
    $('ui-empty-desc').textContent = t.emptyD;
    $('ui-7day-title').textContent = t.sevenDay;
    $('ui-map-title').textContent = t.mapT;
    $('ui-disclaimer').textContent = t.disclaimer;
    $('chatInput').placeholder = t.placeholder;

    const cc = $('chipsContainer');
    cc.innerHTML = '';
    (t.chips || []).forEach(cText => {
      const btn = el('button', 'chip-btn', cText);
      btn.type = 'button';
      btn.onclick = () => { if (!isPending) sendMsg(cText); };
      cc.appendChild(btn);
    });
  }

  // --- 8. Event Handlers ---
  $('chatForm').onsubmit = (e) => { e.preventDefault(); sendMsg($('chatInput').value); };
  $('langSelect').value = currentLang;
  $('langSelect').onchange = (e) => setLanguage(e.target.value);
  $('cycloneToggle').checked = isCyclone;
  $('cycloneToggle').onchange = (e) => { isCyclone = e.target.checked; };
  $('ttsToggle').checked = isTts;
  $('ttsToggle').onchange = (e) => {
    isTts = e.target.checked;
    try { localStorage.setItem('weathergpt_tts', String(isTts)); } catch (_e) {}
    if (!isTts && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  };

  initMic();
  setLanguage(currentLang);
})();
