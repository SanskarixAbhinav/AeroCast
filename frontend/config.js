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

  // Your Supabase project URL (used for both the /chat function fallback above
  // and for Supabase Auth + Search History below). Safe to expose publicly.
  SUPABASE_URL: "https://cefbgewshgyekkkwcqxb.supabase.co",

  // Supabase anon (public) key. Required for sign-in (email / phone) and for
  // the search history feature. Also sent as a bearer token to the Edge
  // Function above when JWT verification is enabled there.
  // Find it in Supabase Dashboard -> Project Settings -> API -> anon public key.
  ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNlZmJnZXdzaGd5ZWtra3djcXhiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyNjY0OTEsImV4cCI6MjEwNTg0MjQ5MX0.u5qK1xalB62bBr_-sVSVriJ4IzYJ8BTb4_Et3jo7Xkw"
};
