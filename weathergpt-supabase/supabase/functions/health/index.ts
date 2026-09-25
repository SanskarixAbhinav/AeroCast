import { corsHeaders, json } from "../_shared/utils.ts";

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  return json({ status: "ok", time: new Date().toISOString() });
});
