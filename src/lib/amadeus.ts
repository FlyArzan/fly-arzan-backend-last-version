// Amadeus Auth Token
export const getAmadeusToken = async () => {
  const url = `${process.env.AMADEUS_BASE_URL}/v1/security/oauth2/token`;

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: process.env.AMADEUS_API_KEY!,
    client_secret: process.env.AMADEUS_API_SECRET!,
  });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body,
  });

  if (!response.ok) {
    throw new Error(`Failed to get amadeus token: ${response.statusText}`);
  }

  return (await response.json()).access_token;
};
