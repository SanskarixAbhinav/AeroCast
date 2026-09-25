// AeroCast / WeatherGPT Frontend Configuration
// No build step required. Keep secrets out of this file.
window.CONFIG = {
  // Automatically use the local server's live engine (/api/chat) on localhost/127.0.0.1,
  // or fall back to your production Supabase Edge Function URL:
  API_URL: (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'))
    ? "/api/chat"
    : "https://cefbgewshgyekkkwcqxb.supabase.co/functions/v1/chat",

  // Set to true to test with built-in realistic canned responses without any backend:
  USE_MOCK: false,

  // Optional: If you deploy the Edge Function with JWT verification enabled,
  // provide the Supabase anon key here:
  ANON_KEY: ""
};
