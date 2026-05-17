// Amadeus Auth Token
export const getAmadeusToken = async () => {
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

  let json: { access_token?: string };
  try {
    json = JSON.parse(rawBody);
  } catch {
    throw new Error(`Amadeus token returned non-JSON: ${rawBody}`);
  }

  if (!json.access_token) {
    console.error("[Amadeus] ❌ No access_token in response:", json);
    throw new Error("Amadeus token response missing access_token");
  }

  console.log("[Amadeus] ✅ Token obtained successfully");
  return json.access_token;
};
