// AeroCast / WeatherGPT Frontend Logic - Vanilla JS
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  function el(tag, cls, txt) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt !== undefined) e.textContent = txt;
    return e;
  }

  const LOCALES = { en: 'en-IN', hi: 'hi-IN', bn: 'bn-IN', ta: 'ta-IN', te: 'te-IN', mr: 'mr-IN' };
  let currentLang = (typeof localStorage !== 'undefined' && localStorage.getItem('weathergpt_lang')) || 'en';
  let isCyclone = false;
  let isTts = (typeof localStorage !== 'undefined' && localStorage.getItem('weathergpt_tts') === 'true') || false;
  let isPending = false;
  let speechRec = null;

  // Map state
  let mapInstance = null;
  let singleMarker = null;
  let regionalLayerGroup = null;
  let mapMode = 'single'; // 'single' | 'regional'
  let lastSingleCoords = { lat: 22.57, lon: 88.36, label: "Kolkata, West Bengal, India" };
  let mapLoadFailed = false;      // true once Leaflet has failed to load from every CDN we tried
  let pendingMapRender = null;    // { lat, lon, label } queued if a query answers before Leaflet is ready

  // --- 1. Multilingual Dictionaries ---
  const I18N = {
    en: {
      title: "AeroCast", subtitle: "AI Weather, Marine & Farming Advisory",
      placeholder: "Ask about weather, rain, spraying, irrigation, marine...",
      cyclone: "Simulate cyclone", tts: "Read aloud", thinking: "AeroCast is thinking...",
      emptyT: "Weather Insights & Advisories", emptyD: "Ask a question to see live conditions, farm decisions, marine waves & map.",
      sevenDay: "7-Day Outlook", mapT: "📍 Location Map",
      disclaimer: "Advisories are based on forecast thresholds, not official government warnings.",
      retry: "Retry", timeout: "Weather request timed out. Please retry.",
      networkErr: "Unable to connect to weather service. Please retry.",
      voiceHint: "Voice input works best in Google Chrome.",
      chips: [
        "Will it rain tomorrow in Kolkata?",
        "Is it safe to spray pesticides in Kolkata tomorrow?",
        "Is it safe for coastal fishing in Mumbai tomorrow?",
        "7-day forecast for Chennai",
        "How much rain did Mumbai get last July?",
        "Any cyclone near Kolkata?"
      ]
    },
    hi: {
      title: "एयरोकास्ट (AeroCast)", subtitle: "कृषि, तटीय व मौसम सलाह सहायक",
      placeholder: "मौसम, बारिश, छिड़काव, सिंचाई या समुद्र के बारे में पूछें...",
      cyclone: "चक्रवात सिमुलेशन", tts: "आवाज में सुनें", thinking: "एयरोकास्ट सोच रहा है...",
      emptyT: "मौसम विवरण और कृषि सलाह", emptyD: "मौसम का सवाल पूछें और यहाँ लाइव स्थिति, कृषि व समुद्री सलाह देखें।",
      sevenDay: "7 दिनों का पूर्वानुमान", mapT: "📍 स्थान का नक्शा",
      disclaimer: "सलाह पूर्वानुमान सीमाओं पर आधारित है, आधिकारिक चेतावनी नहीं।",
      retry: "पुनः प्रयास करें", timeout: "अनुरोध समय समाप्त। कृपया पुनः प्रयास करें।",
      networkErr: "मौसम सेवा से संपर्क नहीं हो सका। कृपया पुनः प्रयास करें।",
      voiceHint: "वॉइस इनपुट गूगल क्रोम में सबसे अच्छा काम करता है।",
      chips: [
        "क्या कल कोलकाता में बारिश होगी?",
        "क्या कल कोलकाता में कीटनाशक छिड़कना सुरक्षित है?",
        "क्या कल मुंबई में समुद्र में मछली पकड़ना सुरक्षित है?",
        "चेन्नई का 7 दिनों का मौसम पूर्वानुमान",
        "मुंबई में पिछले जुलाई में कितनी बारिश हुई थी?",
        "क्या कोलकाता के पास कोई चक्रवात है?"
      ]
    },
    bn: {
      title: "এরোকাস্ট (AeroCast)", subtitle: "কৃষি, সামুদ্রিক ও আবহাওয়া পরামর্শ সহকারী",
      placeholder: "আবহাওয়া, বৃষ্টি, স্প্রে বা সাগরের পরিস্থিতি জিজ্ঞাসা করুন...",
      cyclone: "ঘূর্ণিঝড় ডেমো", tts: "উচ্চস্বরে পড়ুন", thinking: "এরোকাস্ট ভাবছে...",
      emptyT: "আবহাওয়ার তথ্য ও কৃষি পরামর্শ", emptyD: "প্রশ্ন জিজ্ঞাসা করে লাইভ আবহাওয়া, কৃষি ও সামুদ্রিক পরামর্শ দেখুন।",
      sevenDay: "৭ দিনের পূর্বাভাস", mapT: "📍 স্থানের মানচিত্র",
      disclaimer: "পরামর্শ পূর্বাভাসের উপর নির্ভরশীল, সরকারি সতর্কতা নয়।",
      retry: "পুনরায় চেষ্টা করুন", timeout: "অনুরোধের সময় শেষ। দয়া করে আবার চেষ্টা করুন।",
      networkErr: "সার্ভারে সংযোগ করা যায়নি। ইন্টারনেট সংযোগ পরীক্ষা করুন।",
      voiceHint: "ভয়েস ইনপুট ক্রোম ব্রাউজারে সবচেয়ে ভালো কাজ করে।",
      chips: [
        "কলকাতায় কি কাল বৃষ্টি হবে?",
        "কলকাতায় কাল কীটনাশক স্প্রে করা কি নিরাপদ?",
        "কাল কি কলকাতায় সাগরে মাছ ধরা নিরাপদ?",
        "চেন্নাইয়ের ৭ দিনের আবহাওয়ার পূর্বাভাস",
        "গত জুলাইয়ে মুম্বাইতে কত বৃষ্টি হয়েছিল?",
        "কলকাতার কাছে কি কোনো ঘূর্ণিঝড় আছে?"
      ]
    },
    ta: {
      title: "ஏரோகாஸ்ட் (AeroCast)", subtitle: "வானிலை, கடல் மற்றும் விவசாய ஆலோசனை",
      placeholder: "மழை, பூச்சிக்கொல்லி தெளிப்பு, கடல் நிலை பற்றி கேட்கவும்...",
      cyclone: "புயல் மாதிரி", tts: "குரலில் வாசி", thinking: "பதிலளிக்கிறது...",
      emptyT: "வானிலை மற்றும் விவசாய பரிந்துரைகள்", emptyD: "கேள்விகளைக் கேட்டு நேரலை வானிலை, கடல் மற்றும் வரைபடத்தைப் பார்க்கவும்.",
      sevenDay: "7 நாள் முன்னறிவிப்பு", mapT: "📍 இருப்பிட வரைபடம்",
      disclaimer: "ஆலோசனைகள் முன்னறிவிப்பின் அடிப்படையிலானவை, அரசு எச்சரிக்கை அல்ல.",
      retry: "மீண்டும் முயற்சிக்கவும்", timeout: "நேரம் முடிந்தது. மீண்டும் முயற்சிக்கவும்.",
      networkErr: "வானிலை சேவையுடன் இணைக்க முடியவில்லை. மீண்டும் முயற்சிக்கவும்.",
      voiceHint: "குரல் உள்ளீடு Google Chrome-இல் சிறப்பாக செயல்படும்.",
      chips: [
        "நாளை கொல்கத்தாவில் மழை பெய்யுமா?",
        "நாளை கொல்கத்தாவில் பூச்சிக்கொல்லி தெளிப்பது பாதுகாப்பானதா?",
        "நாளை சென்னையில் கடலில் மீன்பிடிப்பது பாதுகாப்பானதா?",
        "சென்னைக்கான 7 நாள் வானிலை முன்னறிவிப்பு",
        "கடந்த ஜூலையில் மும்பையில் எவ்வளவு மழை பெய்தது?",
        "கொல்கத்தா அருகில் புயல் உள்ளதா?"
      ]
    },
    te: {
      title: "ఏరోకాస్ట్ (AeroCast)", subtitle: "వాతావరణం, సముద్ర & వ్యవసాయ సలహా సహాయకుడు",
      placeholder: "వాతావరణం, వర్షం, పిచికారీ, సముద్రం గురించి అడగండి...",
      cyclone: "తుఫాను అనుకరణ", tts: "గట్టిగా చదవండి", thinking: "ఏరోకాస్ట్ ఆలోచిస్తోంది...",
      emptyT: "వాతావరణ సమాచారం & సలహాలు", emptyD: "పరిస్థితులు, వ్యవసాయ నిర్ణయాలు & మ్యాప్ చూడటానికి ప్రశ్న అడగండి.",
      sevenDay: "7-రోజుల సూచన", mapT: "📍 స్థాన మ్యాప్",
      disclaimer: "సలహాలు సూచన పరిమితుల ఆధారంగా ఉన్నాయి, అధికారిక ప్రభుత్వ హెచ్చరికలు కావు.",
      retry: "మళ్లీ ప్రయత్నించండి", timeout: "వాతావరణ అభ్యర్థన సమయం ముగిసింది. దయచేసి మళ్లీ ప్రయత్నించండి.",
      networkErr: "వాతావరణ సేవకు కనెక్ట్ చేయడం సాధ్యం కాలేదు. దయచేసి మళ్లీ ప్రయత్నించండి.",
      voiceHint: "వాయిస్ ఇన్‌పుట్ Google Chromeలో ఉత్తమంగా పనిచేస్తుంది.",
      chips: [
        "రేపు కోల్‌కతాలో వర్షం పడుతుందా?",
        "రేపు కోల్‌కతాలో పురుగుమందులు పిచికారీ చేయడం సురక్షితమేనా?",
        "రేపు చెన్నైలో చేపల వేటకు వెళ్లడం సురక్షితమేనా?",
        "చెన్నైకి 7-రోజుల వాతావరణ సూచన",
        "గత జూలైలో ముంబైలో ఎంత వర్షం పడింది?",
        "కోల్‌కతా దగ్గర తుఫాను ఏదైనా ఉందా?"
      ]
    },
    mr: {
      title: "एयरोकास्ट (AeroCast)", subtitle: "हवामान, सागरी आणि शेती सल्लागार",
      placeholder: "हवामान, पाऊस, फवारणी, सिंचन किंवा समुद्राबद्दल विचारा...",
      cyclone: "चक्रीवादळ सिम्युलेशन", tts: "मोठ्याने वाचा", thinking: "एयरोकास्ट विचार करत आहे...",
      emptyT: "हवामान माहिती आणि सल्ला", emptyD: "स्थिती, शेती निर्णय आणि नकाशा पाहण्यासाठी प्रश्न विचारा.",
      sevenDay: "7-दिवसांचा अंदाज", mapT: "📍 स्थान नकाशा",
      disclaimer: "सल्ला अंदाज मर्यादांवर आधारित आहे, अधिकृत सरकारी इशारा नाही.",
      retry: "पुन्हा प्रयत्न करा", timeout: "हवामान विनंतीची वेळ संपली. कृपया पुन्हा प्रयत्न करा.",
      networkErr: "हवामान सेवेशी कनेक्ट होऊ शकले नाही. कृपया पुन्हा प्रयत्न करा.",
      voiceHint: "व्हॉइस इनपुट गुगल क्रोममध्ये उत्तम काम करते.",
      chips: [
        "उद्या कोलकात्यात पाऊस पडेल का?",
        "उद्या कोलकात्यात कीटकनाशक फवारणी सुरक्षित आहे का?",
        "उद्या मुंबईत समुद्रात मच्छिमारी सुरक्षित आहे का?",
        "चेन्नईसाठी 7-दिवसांचा हवामान अंदाज",
        "गेल्या जुलैमध्ये मुंबईत किती पाऊस झाला?",
        "कोलकात्याजवळ चक्रीवादळ आहे का?"
      ]
    }
  };

  // --- 2. Mock Responses (CONFIG.USE_MOCK) ---
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
    const mockLatency = Math.floor(Math.random() * 80 + 430);

    const isWeather = /weather|rain|forecast|temp|temperature|spray|pesticide|harvest|irrigate|irrigation|marine|sea|ocean|wave|swell|boat|fisherm|cyclone|storm|wind|humidity|shower|climate|7-day|july|history|past/i.test(qL) || demo === "cyclone";

    let loc = null;
    for (const p of PLACES) {
      if (p.match.test(qL)) { loc = p; break; }
    }

    const prepMatch = qL.match(/\b(?:in|for|at|near|of)\s+([a-zA-Z\u0080-\uFFFF]+)\b/i);
    const hasUnrecognizedPlace = prepMatch && !/\b(?:tomorrow|today|yesterday|week|july|spray|pesticide|harvest|irrigation|cyclone|weather|forecast|rain|marine|sea|me|us|the|a|an|this|next)\b/i.test(prepMatch[1]) && !loc;

    if ((!isWeather && !loc) || hasUnrecognizedPlace) {
      return {
        answer: "Please tell me which city or place you mean (e.g., Kolkata, Mumbai, Chennai, Delhi).",
        facts: null,
        alerts: [],
        meta: { source: "Open-Meteo", fetched_at: now, from_cache: false, stale: false, latency_ms: mockLatency }
      };
    }

    if (!loc) loc = PLACES[0];

    // Standard Multi-Model Comparison mock object
    const mockModelComparison = {
      date: tmrw,
      gfs: { model_name: "NOAA GFS (Seamless)", temp_max: 32.4, rain_mm: 14.2, rain_prob: 60 },
      ecmwf: { model_name: "ECMWF IFS", temp_max: 31.8, rain_mm: 12.0, rain_prob: 65 },
      agreement: "High model consensus (GFS & ECMWF agree within 2.5°C / 25% rain prob)",
      agreement_bool: true,
      note: "Two independent forecast models, shown for transparency"
    };

    // Cyclone Demo
    if (demo === "cyclone" || /cyclone|storm|चक्रवात|ঘূর্ণিঝড়|புயல்|తుఫాను|चक्रीवादळ/i.test(qL)) {
      const basin = loc.lon > 80 ? "Bay of Bengal" : "Arabian Sea";
      return {
        answer: `A severe cyclonic storm 'Cyclone DEMO' is active over the ${basin} with winds reaching 110 km/h near ${loc.name}. Coastal fishermen are advised not to venture into the sea.`,
        facts: {
          topic: "cyclone", location: loc.label, lat: loc.lat, lon: loc.lon, stale: false,
          day: { date: tmrw, temp_max: 29, temp_min: 24, rain_mm: 85, rain_prob: 90, wind_max_kmh: 65, gust_max_kmh: 95, et0_mm: 2 },
          cyclone: { name: "Cyclone DEMO", basin: basin, category: "Severe Cyclonic Storm", max_wind_kmh: 110, landfall_estimate: "Coastal area in 36h", advisory: "Fishermen should not go to sea.", simulated: true },
          model_comparison: mockModelComparison
        },
        alerts: [{ type: "cyclone", level: "red", date: tmrw, message: "SIMULATED: Cyclone DEMO. Max wind 110 km/h.", simulated: true, official: false }],
        meta: { source: "Open-Meteo", fetched_at: now, from_cache: false, stale: false, latency_ms: mockLatency }
      };
    }

    // Marine Advisory Intent
    if (/marine|sea|ocean|wave|swell|boat|fisherm|समुद्र|मछुआरे|সাগর|জেলে|கடல்|மீனவர்|సముద్రం|मच्छीमार/i.test(qL)) {
      const coastalCities = ["Kolkata", "Mumbai", "Chennai", "Kochi", "Goa"];
      const isCoastal = coastalCities.includes(loc.name);

      if (isCoastal) {
        return {
          answer: `Marine conditions off ${loc.name} tomorrow are suitable for small craft and fishing: wave heights around 1.1 m with winds at 18 km/h.`,
          facts: {
            topic: "marine", location: loc.label, lat: loc.lat, lon: loc.lon, stale: false,
            day: { date: tmrw, temp_max: 31, temp_min: 25, rain_mm: 4, rain_prob: 30, wind_max_kmh: 18, gust_max_kmh: 28, et0_mm: 3.5 },
            marine: {
              is_coastal: true,
              wave_height_m: 1.1,
              wave_period_s: 6.5,
              swell_wave_height_m: 0.8,
              wave_direction_deg: 260
            },
            flags: {
              marine_safe: true,
              reason: ["calm sea conditions suitable for small craft and fishing"],
              wave_height_m: 1.1,
              wave_period_s: 6.5,
              swell_wave_height_m: 0.8,
              max_wind_kmh: 18
            },
            model_comparison: mockModelComparison
          },
          alerts: [],
          meta: { source: "Open-Meteo Marine API", fetched_at: now, from_cache: false, stale: false, latency_ms: mockLatency }
        };
      } else {
        return {
          answer: `${loc.name} is an inland location. Marine wave and swell advisories are only available for coastal waters. Tomorrow's land forecast: ${loc.name} will reach 33°C with light wind.`,
          facts: {
            topic: "marine", location: loc.label, lat: loc.lat, lon: loc.lon, stale: false,
            day: { date: tmrw, temp_max: 33, temp_min: 24, rain_mm: 0, rain_prob: 10, wind_max_kmh: 12, gust_max_kmh: 20, et0_mm: 4.2 },
            marine: {
              is_coastal: false,
              message: `${loc.name} is an inland location. Marine wave data is only available for coastal regions.`
            },
            flags: {
              marine_safe: null,
              reason: ["location is inland / non-coastal"]
            },
            model_comparison: mockModelComparison
          },
          alerts: [],
          meta: { source: "Open-Meteo", fetched_at: now, from_cache: false, stale: false, latency_ms: mockLatency }
        };
      }
    }

    // Spray Advisory Intent
    if (/spray|pesticide|कीटनाशक|কীটনাশক|பூச்சிக்கொல்லி|पुరుగుమందు|फवारणी/i.test(qL)) {
      return {
        answer: `Spraying pesticides in ${loc.name} tomorrow is not advisable due to expected rain and wind speeds exceeding 15 km/h.`,
        facts: {
          topic: "spray", location: loc.label, lat: loc.lat, lon: loc.lon, stale: false,
          day: { date: tmrw, temp_max: 31, temp_min: 25, rain_mm: 22, rain_prob: 75, wind_max_kmh: 24, gust_max_kmh: 42, et0_mm: 3.2 },
          flags: { spray_safe: false, reason: ["rain likely", "wind>15"], window: `${tmrw}T06:00 to ${tmrw}T18:00`, max_rain_prob: 75, max_wind_kmh: 24, max_temp_c: 31 },
          model_comparison: mockModelComparison
        },
        alerts: getRainAlerts(22, tmrw),
        meta: { source: "Open-Meteo", fetched_at: now, from_cache: false, stale: false, latency_ms: mockLatency }
      };
    }

    // 7-day Forecast Intent
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
        facts: {
          topic: "forecast", location: loc.label, lat: loc.lat, lon: loc.lon, stale: false,
          day: daily[0], daily: daily,
          model_comparison: mockModelComparison
        },
        alerts: [], meta: { source: "Open-Meteo", fetched_at: now, from_cache: true, stale: false, latency_ms: mockLatency }
      };
    }

    // Past History Intent (with daily rows for SVG chart)
    if (/july|history|past|गेल्या|கடந்த|గత|গত|पिछले/i.test(qL)) {
      const histDaily = [];
      for (let dayNum = 1; dayNum <= 31; dayNum++) {
        const dStr = `2025-07-${String(dayNum).padStart(2, '0')}`;
        histDaily.push({
          date: dStr,
          temp_max: 30 + (dayNum % 3),
          temp_min: 25,
          rain_mm: (dayNum === 18) ? 120 : (dayNum % 3 === 0 ? 38 : (dayNum % 2 === 0 ? 14 : 3))
        });
      }
      return {
        answer: `${loc.name} recorded 640 mm of total rain between 2025-07-01 and 2025-07-31, with an average max temperature of 31.2 C. The rainiest day had 120 mm on 2025-07-18.`,
        facts: {
          topic: "history", location: loc.label, lat: loc.lat, lon: loc.lon, stale: false,
          history: {
            start: "2025-07-01", end: "2025-07-31",
            total_rain_mm: 640, avg_temp_max: 31.2,
            rainiest_day: { date: "2025-07-18", rain_mm: 120 },
            daily: histDaily
          }
        },
        alerts: [], meta: { source: "Open-Meteo archive", fetched_at: now, from_cache: true, stale: false, latency_ms: mockLatency }
      };
    }

    // Default Rain / General Query
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
        flags: { irrigate: false, reason: ["enough rain expected in next 2 days"], rain_next_2_days_mm: rainMm + 7, et0_mm: 3.5 },
        model_comparison: mockModelComparison
      },
      alerts: getRainAlerts(rainMm, tmrw),
      meta: { source: "Open-Meteo", fetched_at: now, from_cache: false, stale: false, latency_ms: mockLatency }
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

  const MIC_ERR_MSG = {
    en: {
      insecure: "Voice input needs a secure (https://) connection.",
      'not-allowed': "Microphone permission denied. Allow microphone access in your browser's site settings, then try again.",
      'no-speech': "Didn't catch that — please try again.",
      'audio-capture': "No microphone found on this device.",
      network: "Voice input needs a network connection. Please check your connection and retry.",
      generic: "Voice input failed. Please try again or type your question."
    }
  };
  function micErrText(key) {
    return (MIC_ERR_MSG.en[key]) || MIC_ERR_MSG.en.generic;
  }

  function initMic() {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    const micBtn = $('micBtn');
    const hint = $('voiceHint');

    // Voice input requires a secure context (HTTPS, or localhost). If served
    // over plain http on a non-local host, the constructor either doesn't
    // exist or silently fails, which used to look like "the mic button does
    // nothing" with no explanation.
    const isSecure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';

    if (!SpeechRec || !isSecure) {
      if (micBtn) micBtn.style.display = 'none';
      if (hint) hint.textContent = !isSecure ? micErrText('insecure') : (I18N[currentLang]?.voiceHint || '');
      return;
    }
    speechRec = new SpeechRec();
    speechRec.continuous = false;
    speechRec.interimResults = false;
    speechRec.maxAlternatives = 1;
    speechRec.onstart = () => {
      micBtn.classList.add('listening');
      micBtn.setAttribute('aria-label', 'Listening...');
      if (hint) hint.textContent = '';
    };
    speechRec.onresult = (e) => { $('chatInput').value = e.results[0][0].transcript; };
    speechRec.onerror = (e) => {
      micBtn.classList.remove('listening');
      // Surface *why* it failed instead of silently doing nothing — this was
      // the main reason the mic looked "broken" (e.g. permission denied).
      if (hint) hint.textContent = micErrText(e?.error);
    };
    speechRec.onend = () => {
      micBtn.classList.remove('listening');
      micBtn.setAttribute('aria-label', 'Voice input');
      if ($('chatInput').value.trim() && !isPending) sendMsg($('chatInput').value.trim());
    };
    micBtn.addEventListener('click', () => {
      if (isPending) return;
      if (hint) hint.textContent = '';
      speechRec.lang = LOCALES[currentLang] || 'en-IN';
      try {
        speechRec.start();
      } catch (_e) {
        // "already started" is the most common throw here — stop and let the
        // user click again rather than leaving the button inert.
        try { speechRec.stop(); } catch (_e2) { /* no-op */ }
      }
    });
  }

  // --- 4. Leaflet Map (Single Location & Regional Disaster Watch) ---
  const REGIONAL_HUBS = [
    { name: "Kolkata", lat: 22.57, lon: 88.36 },
    { name: "Mumbai", lat: 19.07, lon: 72.87 },
    { name: "Chennai", lat: 13.08, lon: 80.27 },
    { name: "Delhi", lat: 28.61, lon: 77.21 },
    { name: "Bengaluru", lat: 12.97, lon: 77.59 },
    { name: "Hyderabad", lat: 17.38, lon: 78.48 }
  ];

  function ensureMap() {
    if (!window.L) return null;
    if (mapInstance) return mapInstance;
    try {
      mapInstance = window.L.map('weatherMap', { zoomControl: true, scrollWheelZoom: false }).setView([22.57, 88.36], 10);
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 18
      }).addTo(mapInstance);
      regionalLayerGroup = window.L.layerGroup().addTo(mapInstance);
      return mapInstance;
    } catch (e) {
      // A Leaflet runtime error (e.g. bad container, plugin conflict) must
      // never break the rest of the dashboard - degrade gracefully instead.
      console.error('AeroCast: map initialization failed', e);
      mapInstance = null;
      return null;
    }
  }

  function showMapUnavailable() {
    const wrapper = $('mapWrapper');
    if (wrapper) wrapper.style.display = 'flex';
    const mapEl = $('weatherMap');
    if (mapEl) mapEl.innerHTML = '<div class="map-unavailable">🗺️ Map temporarily unavailable</div>';
  }

  function renderMap(lat, lon, label) {
    if (!lat || !lon) return;
    lastSingleCoords = { lat, lon, label };

    // If Leaflet hasn't loaded yet (or failed), queue this render. The
    // 'leaflet:ready' event listener below will replay it once Leaflet is
    // available. This never delays or blocks the chat response.
    if (!window.L) {
      pendingMapRender = { lat, lon, label };
      if (mapLoadFailed) showMapUnavailable();
      return;
    }

    const mapWrapper = $('mapWrapper');
    if (!mapWrapper) return;
    mapWrapper.style.display = 'flex';

    // Use requestAnimationFrame to ensure the container is visible/sized
    // before Leaflet tries to measure its dimensions.
    requestAnimationFrame(() => {
      try {
        const map = ensureMap();
        if (!map) { showMapUnavailable(); return; }

        if (mapMode === 'single') {
          showSingleMapView(lat, lon, label);
        } else {
          renderRegionalMap();
        }
      } catch (mapErr) {
        console.error('AeroCast: map render failed', mapErr);
        showMapUnavailable();
      }
    });
  }

  // Fired by index.html once Leaflet finishes loading (from cdnjs or the
  // unpkg fallback). Replays whatever query most recently tried to render
  // a map while Leaflet wasn't ready yet.
  window.addEventListener('leaflet:ready', () => {
    if (pendingMapRender) {
      const { lat, lon, label } = pendingMapRender;
      pendingMapRender = null;
      renderMap(lat, lon, label);
    }
  });
  window.addEventListener('leaflet:unavailable', () => {
    mapLoadFailed = true;
    if (pendingMapRender) { pendingMapRender = null; showMapUnavailable(); }
  });

  function showSingleMapView(lat, lon, label) {
    mapMode = 'single';
    $('mapTabSingle')?.classList.add('active');
    $('mapTabRegional')?.classList.remove('active');
    $('mapTabSingle')?.setAttribute('aria-selected', 'true');
    $('mapTabRegional')?.setAttribute('aria-selected', 'false');
    if ($('regionalNotice')) $('regionalNotice').style.display = 'none';

    if (regionalLayerGroup) regionalLayerGroup.clearLayers();
    if (!singleMarker) {
      singleMarker = window.L.marker([lat, lon]).addTo(mapInstance);
    } else {
      singleMarker.setLatLng([lat, lon]);
      if (!mapInstance.hasLayer(singleMarker)) singleMarker.addTo(mapInstance);
    }
    singleMarker.bindPopup(`<strong>${label}</strong>`).openPopup();
    mapInstance.setView([lat, lon], 10);
    // Invalidate size multiple times to handle CSS transitions/display changes
    setTimeout(() => { if (mapInstance) mapInstance.invalidateSize(); }, 100);
    setTimeout(() => { if (mapInstance) mapInstance.invalidateSize(); }, 400);
  }

  async function renderRegionalMap() {
    mapMode = 'regional';
    $('mapTabSingle')?.classList.remove('active');
    $('mapTabRegional')?.classList.add('active');
    $('mapTabSingle')?.setAttribute('aria-selected', 'false');
    $('mapTabRegional')?.setAttribute('aria-selected', 'true');
    if ($('regionalNotice')) $('regionalNotice').style.display = 'flex';

    const map = ensureMap();
    if (!map) return;

    if (singleMarker && map.hasLayer(singleMarker)) {
      map.removeLayer(singleMarker);
    }
    if (regionalLayerGroup) regionalLayerGroup.clearLayers();

    // Fetch multi-city forecasts in a single call or fallback
    let multiData = null;
    if (!window.CONFIG?.USE_MOCK) {
      try {
        const lats = REGIONAL_HUBS.map(h => h.lat).join(',');
        const lons = REGIONAL_HUBS.map(h => h.lon).join(',');
        const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&daily=precipitation_sum,precipitation_probability_max,temperature_2m_max,wind_gusts_10m_max&timezone=auto`);
        if (res.ok) multiData = await res.json();
      } catch (_e) {}
    }

    const markersList = [];

    REGIONAL_HUBS.forEach((hub, idx) => {
      let rainMm = 12;
      let tempMax = 32;
      let gustMax = 25;
      let level = 'green';
      let alertMsg = 'Normal conditions. No weather advisory.';

      // Process real data if available
      const cityForecast = Array.isArray(multiData) ? multiData[idx] : null;
      if (cityForecast?.daily) {
        rainMm = Math.round((cityForecast.daily.precipitation_sum?.[0] ?? 0) * 10) / 10;
        tempMax = Math.round(cityForecast.daily.temperature_2m_max?.[0] ?? 30);
        gustMax = Math.round(cityForecast.daily.wind_gusts_10m_max?.[0] ?? 20);
      } else {
        // Canned hub differences for demo
        if (hub.name === "Kolkata") {
          rainMm = isCyclone ? 85 : 35;
          tempMax = 30;
          gustMax = isCyclone ? 95 : 38;
        } else if (hub.name === "Mumbai") {
          rainMm = 70; tempMax = 29; gustMax = 42;
        } else if (hub.name === "Chennai") {
          rainMm = 8; tempMax = 34; gustMax = 52;
        } else if (hub.name === "Delhi") {
          rainMm = 0; tempMax = 36; gustMax = 18;
        }
      }

      // Check alert thresholds
      if (isCyclone && (hub.name === "Kolkata" || hub.name === "Chennai")) {
        level = 'red';
        alertMsg = 'SIMULATED: Severe Cyclone DEMO alert (winds > 90 km/h).';
      } else if (rainMm >= 115.6) {
        level = 'red';
        alertMsg = `Very heavy rainfall (${rainMm} mm). Waterlogging risk.`;
      } else if (tempMax >= 45) {
        level = 'red';
        alertMsg = `Extreme heat (${tempMax}°C). Stay indoors.`;
      } else if (rainMm >= 64.5) {
        level = 'orange';
        alertMsg = `Heavy rainfall (${rainMm} mm). High runoff.`;
      } else if (tempMax >= 40) {
        level = 'orange';
        alertMsg = `Heatwave warning (${tempMax}°C).`;
      } else if (gustMax >= 70) {
        level = 'orange';
        alertMsg = `Damaging wind gusts (${gustMax} km/h).`;
      } else if (gustMax >= 50 || rainMm >= 25) {
        level = 'yellow';
        alertMsg = `Moderate weather advisory (wind ${gustMax} km/h, rain ${rainMm} mm).`;
      }

      // Color scheme based on severity
      const colorMap = {
        red: { color: '#ef4444', radius: 16, weight: 3 },
        orange: { color: '#f97316', radius: 13, weight: 2 },
        yellow: { color: '#eab308', radius: 11, weight: 2 },
        green: { color: '#10b981', radius: 9, weight: 2 }
      };
      const cfg = colorMap[level] || colorMap.green;

      const circle = window.L.circleMarker([hub.lat, hub.lon], {
        color: cfg.color,
        fillColor: cfg.color,
        fillOpacity: 0.82,
        radius: cfg.radius,
        weight: cfg.weight
      });

      const popupHtml = `
        <div style="font-family:system-ui,sans-serif; font-size:12px; line-height:1.45; min-width:180px;">
          <strong style="font-size:14px; color:#0f172a;">${hub.name}</strong><br>
          <span style="display:inline-block; margin:3px 0 5px; padding:2px 7px; border-radius:4px; font-weight:700; color:#fff; font-size:10px; background:${cfg.color}">
            ${level.toUpperCase()} ADVISORY
          </span><br>
          <span style="color:#334155;">${alertMsg}</span><br>
          <hr style="border:0; border-top:1px solid #e2e8f0; margin:5px 0;">
          <small style="color:#64748b;">🌡️ Max: ${tempMax}°C | 🌧️ Rain: ${rainMm} mm | 💨 Gust: ${gustMax} km/h</small>
        </div>
      `;
      circle.bindPopup(popupHtml);
      regionalLayerGroup.addLayer(circle);
      markersList.push([hub.lat, hub.lon]);
    });

    // Fit map bounds to show regional coverage of India
    map.fitBounds([[8, 68], [32, 92]], { padding: [25, 25] });
    setTimeout(() => { if (mapInstance) mapInstance.invalidateSize(); }, 150);
  }

  // --- 5. Hand-Rolled Climate Trend SVG Chart ---
  function renderHistorySvgChart(history) {
    if (!history) return '';
    const rows = history.daily || [];
    if (!rows.length) return '';

    const width = 420;
    const height = 120;
    const padLeft = 32;
    const padRight = 10;
    const padTop = 16;
    const padBottom = 22;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    const maxRain = Math.max(...rows.map(r => r.rain_mm ?? 0), 10);
    const n = rows.length;
    const barWidth = Math.max(2, (plotW / n) - 2);

    let barsSvg = '';
    rows.forEach((r, i) => {
      const rain = r.rain_mm ?? 0;
      const barH = (rain / maxRain) * plotH;
      const x = padLeft + (i * (plotW / n)) + 1;
      const y = padTop + (plotH - barH);
      const isRainiest = (r.date === history.rainiest_day?.date) || (rain === maxRain && rain > 0);
      const barClass = isRainiest ? 'chart-bar rainiest' : 'chart-bar';

      barsSvg += `
        <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${Math.max(1, barH).toFixed(1)}" class="${barClass}">
          <title>${r.date}: ${rain} mm rain, ${r.temp_max}°C max</title>
        </rect>
      `;
    });

    const midIdx = Math.floor(n / 2);
    const startDate = rows[0]?.date ? rows[0].date.slice(5) : '';
    const midDate = rows[midIdx]?.date ? rows[midIdx].date.slice(5) : '';
    const endDate = rows[n - 1]?.date ? rows[n - 1].date.slice(5) : '';

    return `
      <div class="history-chart-wrapper">
        <div class="history-chart-header">
          <span>🌧️ Daily Rainfall Trend (mm)</span>
          <span>Peak: ${Math.round(maxRain)} mm</span>
        </div>
        <svg viewBox="0 0 ${width} ${height}" class="history-svg-chart" aria-label="Daily rainfall bar chart">
          <!-- Grid lines -->
          <line x1="${padLeft}" y1="${padTop}" x2="${width - padRight}" y2="${padTop}" class="chart-grid-line" />
          <line x1="${padLeft}" y1="${padTop + plotH / 2}" x2="${width - padRight}" y2="${padTop + plotH / 2}" class="chart-grid-line" />
          <line x1="${padLeft}" y1="${padTop + plotH}" x2="${width - padRight}" y2="${padTop + plotH}" class="chart-grid-line" />

          <!-- Y-axis labels -->
          <text x="${padLeft - 4}" y="${padTop + 4}" text-anchor="end" class="chart-label">${Math.round(maxRain)}</text>
          <text x="${padLeft - 4}" y="${padTop + plotH / 2 + 3}" text-anchor="end" class="chart-label">${Math.round(maxRain / 2)}</text>
          <text x="${padLeft - 4}" y="${padTop + plotH}" text-anchor="end" class="chart-label">0</text>

          <!-- Bars -->
          ${barsSvg}

          <!-- X-axis baseline -->
          <line x1="${padLeft}" y1="${padTop + plotH}" x2="${width - padRight}" y2="${padTop + plotH}" stroke="var(--border)" stroke-width="1" />

          <!-- X-axis labels -->
          <text x="${padLeft + 4}" y="${height - 6}" text-anchor="start" class="chart-label">${startDate}</text>
          <text x="${padLeft + plotW / 2}" y="${height - 6}" text-anchor="middle" class="chart-label">${midDate}</text>
          <text x="${width - padRight - 4}" y="${height - 6}" text-anchor="end" class="chart-label">${endDate}</text>
        </svg>
      </div>
    `;
  }

  // --- 6. Message & Data Card Rendering ---
  function addBubble(role, text, meta) {
    const row = el('div', `chat-bubble-row ${role}`);
    row.appendChild(el('div', 'bubble-meta', role === 'user' ? 'You' : 'AeroCast'));
    const b = el('div', 'bubble', text);
    row.appendChild(b);

    if (role === 'assistant') {
      const act = el('div', 'bubble-actions');

      // Speaker Button (TTS) — only rendered while the "Read aloud" toggle is
      // on. Previously this button showed on every answer regardless of the
      // toggle, which looked like a stray control when read-aloud was off.
      const spk = el('button', 'btn-speaker' + (isTts ? '' : ' btn-speaker-hidden'));
      spk.type = 'button';
      spk.title = 'Read aloud';
      spk.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>';
      spk.onclick = () => speak(text);
      act.appendChild(spk);

      // Latency Pill (Real measured latency)
      if (meta && meta.latency_ms != null) {
        const ms = meta.latency_ms;
        const latTxt = ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;
        const latPill = el('span', 'latency-pill', `⚡ Answered in ${latTxt}`);
        act.appendChild(latPill);
      }

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

    // Cyclone Panel
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

    // Marine Panel
    const marinePanel = $('marinePanel');
    if (facts.marine) {
      marinePanel.style.display = 'flex';
      marinePanel.innerHTML = '';
      if (facts.marine.is_coastal) {
        const head = el('div', 'marine-heading');
        head.innerHTML = `<span>🌊 Coastal Marine Advisory</span><span class="alert-tag">${facts.flags?.marine_safe ? 'CALM WATERS' : 'ROUGH SEAS'}</span>`;
        marinePanel.appendChild(head);
        const stats = el('div', 'marine-stats');
        stats.innerHTML = `
          <span>🌊 Waves: ${facts.marine.wave_height_m}m</span>
          <span>⏱️ Period: ${facts.marine.wave_period_s}s</span>
          <span>🏄 Swell: ${facts.marine.swell_wave_height_m}m</span>
        `;
        marinePanel.appendChild(stats);
      } else {
        marinePanel.innerHTML = `<div>📍 <strong>Inland:</strong> ${facts.marine.message || 'Marine wave forecasts are only available for coastal waters.'}</div>`;
      }
    } else { marinePanel.style.display = 'none'; }

    // Flags / Verdict Badge
    const verd = $('verdictContainer');
    if (facts.flags) {
      verd.style.display = 'flex'; verd.innerHTML = '';
      let badgeCls = 'verdict-badge', badgeTxt = '';
      if (facts.flags.marine_safe !== undefined) {
        if (facts.flags.marine_safe === true) {
          badgeCls += ' suitable';
          badgeTxt = '⚓ Marine: Suitable for Fishing & Small Craft';
        } else if (facts.flags.marine_safe === false) {
          badgeCls += ' not-advisable';
          badgeTxt = '⚠️ Marine: Not Advisable (Rough Sea)';
        } else {
          badgeCls += ' suitable';
          badgeTxt = 'ℹ️ Marine: Non-Coastal Location';
        }
      } else if (facts.flags.spray_safe !== undefined) {
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

    // Current Conditions
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

    // Day Summary
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

    // Multi-NWP Model Comparison Panel
    const mcPanel = $('modelComparisonPanel');
    const mc = facts.model_comparison;
    if (mc && mc.gfs && mc.ecmwf) {
      mcPanel.style.display = 'flex';
      mcPanel.innerHTML = '';

      const mHeader = el('div', 'model-comp-header');
      const mTitle = el('div', 'model-comp-title');
      mTitle.innerHTML = '<span>🌐</span> NWP Ensemble Comparison';
      mHeader.appendChild(mTitle);

      const mBadge = el('span', `model-consensus-badge ${mc.agreement_bool ? '' : 'divergent'}`,
        mc.agreement_bool ? '✅ High Model Consensus' : '⚠️ Model Divergence'
      );
      mHeader.appendChild(mBadge);
      mcPanel.appendChild(mHeader);

      const mGrid = el('div', 'model-grid');

      // GFS Column
      const gfsCard = el('div', 'model-card');
      gfsCard.appendChild(el('div', 'model-name', '🇺🇸 NOAA GFS'));
      const gfsVals = el('div', 'model-values');
      gfsVals.innerHTML = `
        <span>🌡️ Max: <strong>${mc.gfs.temp_max != null ? mc.gfs.temp_max + '°C' : '--'}</strong></span>
        <span>🌧️ Rain: <strong>${mc.gfs.rain_prob != null ? mc.gfs.rain_prob + '%' : '--'}</strong></span>
        <span>💧 Sum: <strong>${mc.gfs.rain_mm != null ? mc.gfs.rain_mm + ' mm' : '--'}</strong></span>
      `;
      gfsCard.appendChild(gfsVals);
      mGrid.appendChild(gfsCard);

      // ECMWF Column
      const ecmwfCard = el('div', 'model-card');
      ecmwfCard.appendChild(el('div', 'model-name', '🇪🇺 ECMWF IFS'));
      const ecmwfVals = el('div', 'model-values');
      ecmwfVals.innerHTML = `
        <span>🌡️ Max: <strong>${mc.ecmwf.temp_max != null ? mc.ecmwf.temp_max + '°C' : '--'}</strong></span>
        <span>🌧️ Rain: <strong>${mc.ecmwf.rain_prob != null ? mc.ecmwf.rain_prob + '%' : '--'}</strong></span>
        <span>💧 Sum: <strong>${mc.ecmwf.rain_mm != null ? mc.ecmwf.rain_mm + ' mm' : '--'}</strong></span>
      `;
      ecmwfCard.appendChild(ecmwfVals);
      mGrid.appendChild(ecmwfCard);

      mcPanel.appendChild(mGrid);
      mcPanel.appendChild(el('div', 'model-note', mc.note || 'Two independent forecast models, shown for transparency.'));
    } else {
      mcPanel.style.display = 'none';
    }

    // 7-Day Outlook
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

    // History & Inline SVG Climate Trend Chart
    const hist = $('historyPanel');
    if (facts.history) {
      hist.style.display = 'flex'; hist.innerHTML = '';
      hist.appendChild(el('div', '', `📊 Rain History (${facts.history.start} to ${facts.history.end})`));
      hist.appendChild(el('div', '', `Total Rain: ${facts.history.total_rain_mm} mm | Avg Max Temp: ${facts.history.avg_temp_max} °C`));
      hist.appendChild(el('div', '', `Rainiest Day: ${facts.history.rainiest_day?.date} (${facts.history.rainiest_day?.rain_mm} mm)`));

      // Append hand-rolled SVG climate trend chart
      const chartWrapper = el('div');
      chartWrapper.innerHTML = renderHistorySvgChart(facts.history);
      hist.appendChild(chartWrapper);
    } else { hist.style.display = 'none'; }

    renderMap(facts.lat, facts.lon, facts.location || 'Location');
  }

  // --- 7. Send Pipeline ---
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
        await new Promise(r => setTimeout(r, 550));
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
          addBubble('assistant', json?.error || `Error (HTTP ${res.status})`, json?.meta);
          return;
        }
        if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
        data = json;
      }
      if (data) {
        const ans = data.answer || 'Weather information received.';
        addBubble('assistant', ans, data.meta);
        renderData(data.facts, data.alerts, data.meta);
        if (isTts) speak(ans);
        window.dispatchEvent(new CustomEvent('aerocast:query-answered', {
          detail: { question: q, lang: currentLang, location: data.facts?.location || null, topic: data.facts?.topic || null }
        }));
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

  // --- 8. Language Switcher ---
  function setLanguage(lang) {
    currentLang = lang;
    try { localStorage.setItem('weathergpt_lang', lang); } catch (_e) {}
    window.dispatchEvent(new CustomEvent('aerocast:lang-changed', { detail: { lang } }));
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

  // --- 9. Event Listeners & Wire-up ---
  $('chatForm').onsubmit = (e) => { e.preventDefault(); sendMsg($('chatInput').value); };
  window.addEventListener('aerocast:reask', (e) => {
    const text = e.detail?.text;
    if (text) sendMsg(text);
  });
  $('langSelect').value = currentLang;
  $('langSelect').onchange = (e) => setLanguage(e.target.value);
  $('cycloneToggle').checked = isCyclone;
  $('cycloneToggle').onchange = (e) => { isCyclone = e.target.checked; };
  $('ttsToggle').checked = isTts;
  $('ttsToggle').onchange = (e) => {
    isTts = e.target.checked;
    try { localStorage.setItem('weathergpt_tts', String(isTts)); } catch (_e) {}
    if (!isTts && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    // Show/hide the per-answer speaker buttons on messages already in the
    // thread, not just future ones, so turning "Read aloud" off immediately
    // removes the button instead of leaving it dangling on old replies.
    document.querySelectorAll('#chatThread .btn-speaker').forEach((btn) => {
      btn.classList.toggle('btn-speaker-hidden', !isTts);
    });
  };

  // Map Tab Controls
  $('mapTabSingle')?.addEventListener('click', () => {
    if (lastSingleCoords) {
      showSingleMapView(lastSingleCoords.lat, lastSingleCoords.lon, lastSingleCoords.label);
    }
  });
  $('mapTabRegional')?.addEventListener('click', () => {
    renderRegionalMap();
  });

  // Architecture & Scope Modal Dialog
  const archBtn = $('archBtn');
  const archModal = $('archModal');
  const modalCloseBtn = $('modalCloseBtn');
  if (archBtn && archModal) {
    archBtn.onclick = () => {
      if (typeof archModal.showModal === 'function') {
        archModal.showModal();
      } else {
        archModal.setAttribute('open', '');
      }
    };
  }
  if (modalCloseBtn && archModal) {
    modalCloseBtn.onclick = () => {
      if (typeof archModal.close === 'function') {
        archModal.close();
      } else {
        archModal.removeAttribute('open');
      }
    };
  }
  if (archModal) {
    archModal.addEventListener('click', (e) => {
      if (e.target === archModal) {
        if (typeof archModal.close === 'function') archModal.close();
        else archModal.removeAttribute('open');
      }
    });
  }

  // Register PWA Service Worker
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').then((reg) => {
        // Ask the SW to check for a fresh version right away, so a phone
        // that already installed an older service worker (before this
        // fix) doesn't keep serving stale app.js/style.css indefinitely.
        reg.update().catch(() => {});
      }).catch(() => {});
    });
  }

  initMic();
  setLanguage(currentLang);
})();
