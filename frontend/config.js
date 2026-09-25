// WeatherGPT Frontend Configuration
// No build step required. Keep secrets out of this file.
window.CONFIG = {
  // Replace with your hosted Supabase Edge Function URL:
  // e.g. "https://YOUR_PROJECT_REF.supabase.co/functions/v1/chat"
  API_URL: "https://<ref>.supabase.co/functions/v1/chat",

  // Set to true to test with built-in realistic canned responses without backend:
  USE_MOCK: true,

  // Optional: If you deploy the Edge Function with JWT verification enabled,
  // provide the Supabase anon key here:
  ANON_KEY: ""
};
