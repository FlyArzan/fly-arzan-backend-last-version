// ─── In-memory token cache (Amadeus tokens last ~30 min) ─────────────────────
let _cachedToken: string | null = null;
let _tokenExpiresAt = 0; // epoch ms

// Amadeus Auth Token
export const getAmadeusToken = async () => {
  // Return cached token if still valid (with 60s safety buffer)
  if (_cachedToken && Date.now() < _tokenExpiresAt - 60_000) {
    return _cachedToken;
  }

  const url = `${process.env.AMADEUS_BASE_URL}/v1/security/oauth2/token`;

  console.log("[Amadeus] Requesting token from:", url);
  console.log(
    "[Amadeus] API_KEY:",
    process.env.AMADEUS_API_KEY
      ? `${process.env.AMADEUS_API_KEY.slice(0, 8)}...`
      : "⚠️ NOT SET",
  );
  console.log(
    "[Amadeus] API_SECRET:",
    process.env.AMADEUS_API_SECRET ? "SET" : "⚠️ NOT SET",
  );

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: process.env.AMADEUS_API_KEY!,
    client_secret: process.env.AMADEUS_API_SECRET!,
  });

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body,
    });
  } catch (networkErr) {
    console.error("[Amadeus] ❌ Network error on token request:", networkErr);
    throw new Error(`Amadeus token network error: ${String(networkErr)}`);
  }

  const rawBody = await response.text();
  console.log(
    "[Amadeus] Token response status:",
    response.status,
    response.statusText,
  );
  console.log("[Amadeus] Token response body:", rawBody);

  if (!response.ok) {
    throw new Error(
      `Failed to get amadeus token (${response.status} ${response.statusText}): ${rawBody}`,
    );
  }

  let json: { access_token?: string; expires_in?: number };
  try {
    json = JSON.parse(rawBody);
  } catch {
    throw new Error(`Amadeus token returned non-JSON: ${rawBody}`);
  }

  if (!json.access_token) {
    console.error("[Amadeus] ❌ No access_token in response:", json);
    throw new Error("Amadeus token response missing access_token");
  }

  // Cache token for subsequent calls (Amadeus default ~1799s)
  const expiresIn = json.expires_in ?? 1799;
  _cachedToken = json.access_token;
  _tokenExpiresAt = Date.now() + expiresIn * 1000;

  console.log(
    `[Amadeus] ✅ Token obtained successfully (cached for ${expiresIn}s)`,
  );
  return json.access_token;
};
