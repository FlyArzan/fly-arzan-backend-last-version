import { getAmadeusToken } from "@/lib/amadeus.js";
import { HTTPException } from "hono/http-exception";
import { format } from "date-fns";
import type { FlightOfferSearchQueryType } from "@/schema/flightSearchSchema.js";
import type { FlightMulticityRequestType } from "@/schema/flightMulticitySchema.js";

// Flight Offer BASE API
const FLIGHT_OFFER_API = `${process.env.AMADEUS_BASE_URL}/v2/shopping`;
const FLIGHT_DATES_API = `${process.env.AMADEUS_BASE_URL}/v1/shopping`;

export const flightOfferService = {
  // Get Flight Offers
  async getFlightOffers(queries: FlightOfferSearchQueryType) {
    const token = await getAmadeusToken();

    if (!token) {
      throw new HTTPException(502);
    }

    // Build Query - only include required parameters
    const searchQueries = new URLSearchParams({
      originLocationCode: queries.originLocationCode,
      destinationLocationCode: queries.destinationLocationCode,
      departureDate: format(queries.departureDate, "yyyy-MM-dd"),
      adults: queries.adults.toString(),
      travelClass: queries.travelClass,
      currencyCode: "USD",
    });

    // Children optional
    if (queries.children !== undefined && queries.children > 0) {
      searchQueries.append("children", queries.children.toString());
    }

    // Return date (Only for round-trip)
    if (queries.returnDate !== undefined && queries.returnDate !== null) {
      searchQueries.append(
        "returnDate",
        format(queries.returnDate, "yyyy-MM-dd"),
      );
    }

    const url = `${FLIGHT_OFFER_API}/flight-offers?${searchQueries.toString()}`;

    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      let parsedError: { errors?: { code?: number; title?: string }[] } = {};
      try {
        parsedError = JSON.parse(errorBody);
      } catch {}

      const errorCodes = parsedError.errors?.map((e) => e.code) ?? [];
      // 38189 = no cached results, 38190 = no data for this route in test env
      // Return empty result rather than 500 so the UI shows "no flights found"
      if (errorCodes.some((c) => c === 38189 || c === 38190)) {
        return { data: [], dictionaries: {} };
      }

      console.error(
        `[Amadeus] getFlightOffers failed (${response.status} ${response.statusText}):`,
        errorBody,
      );
      throw new HTTPException(500, {
        message: `Failed to search flights: ${response.statusText}`,
      });
    }

    const json = await response.json();
    // Amadeus sometimes returns 200 with an errors array (e.g. code 38189)
    if (json?.errors?.length) {
      const codes = json.errors.map((e: { code?: number }) => e.code);
      if (codes.some((c: number) => c === 38189 || c === 38190)) {
        return { data: [], dictionaries: {} };
      }
    }
    return json;
  },

  // Get Multi-City Flight Offers
  async getMultiCityFlightOffers(requestData: FlightMulticityRequestType) {
    const token = await getAmadeusToken();

    if (!token) {
      throw new HTTPException(502);
    }

    const url = `${FLIGHT_OFFER_API}/flight-offers`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestData),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      let parsedError: { errors?: { code?: number }[] } = {};
      try {
        parsedError = JSON.parse(errorBody);
      } catch {}

      const errorCodes = parsedError.errors?.map((e) => e.code) ?? [];
      if (errorCodes.some((c) => c === 38189 || c === 38190)) {
        return { data: [], dictionaries: {} };
      }

      console.error(
        `[Amadeus] getMultiCityFlightOffers failed (${response.status} ${response.statusText}):`,
        errorBody,
      );
      throw new HTTPException(500, {
        message: `Failed to search multi-city flights: ${response.statusText}`,
      });
    }

    return await response.json();
  },

  // Get Cheapest Flight Dates (for flexible dates calendar) - uses cached data, limited routes in test
  async getCheapestFlightDates(params: {
    origin: string;
    destination: string;
    departureDate?: string;
    oneWay?: boolean;
    duration?: string;
    nonStop?: boolean;
    viewBy?: "DATE" | "DESTINATION" | "DURATION" | "WEEK";
  }) {
    const token = await getAmadeusToken();

    if (!token) {
      throw new HTTPException(502);
    }

    // Build Query
    const searchQueries = new URLSearchParams({
      origin: params.origin,
      destination: params.destination,
    });

    // Optional parameters
    if (params.departureDate) {
      searchQueries.append("departureDate", params.departureDate);
    }
    if (params.oneWay !== undefined) {
      searchQueries.append("oneWay", params.oneWay.toString());
    }
    if (params.duration) {
      searchQueries.append("duration", params.duration);
    }
    if (params.nonStop !== undefined) {
      searchQueries.append("nonStop", params.nonStop.toString());
    }
    if (params.viewBy) {
      searchQueries.append("viewBy", params.viewBy);
    }

    const url = `${FLIGHT_DATES_API}/flight-dates?${searchQueries.toString()}`;

    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Amadeus flight-dates error:", errorText);
      throw new HTTPException(500, {
        message: `Failed to get cheapest flight dates: ${response.statusText}`,
      });
    }

    return await response.json();
  },

  // Get prices for a date range using Flight Cheapest Date Search API (single call, efficient)
  // Falls back to Flight Offers Search if route not in cache
  async getFlexibleDatePrices(params: {
    origin: string;
    destination: string;
    departureDate?: string; // Start date YYYY-MM-DD
    endDate?: string; // End date YYYY-MM-DD (for range)
    oneWay?: boolean;
    viewBy?: "DATE" | "DURATION" | "WEEK";
  }) {
    const token = await getAmadeusToken();

    if (!token) {
      throw new HTTPException(502);
    }

    // Build date range for Flight Cheapest Date Search API
    // Format: departureDate=2025-12-01,2025-12-31 (comma-separated range)
    let dateRange = params.departureDate || "";
    if (params.departureDate && params.endDate) {
      dateRange = `${params.departureDate},${params.endDate}`;
    }

    // Try Flight Cheapest Date Search API first (single call, cached data)
    const searchQueries = new URLSearchParams({
      origin: params.origin,
      destination: params.destination,
    });

    if (dateRange) {
      searchQueries.append("departureDate", dateRange);
    }
    if (params.oneWay !== undefined) {
      searchQueries.append("oneWay", params.oneWay.toString());
    }
    // Use DATE view to get prices per day
    searchQueries.append("viewBy", params.viewBy || "DATE");

    const url = `${FLIGHT_DATES_API}/flight-dates?${searchQueries.toString()}`;

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        const data = await response.json();
        return this.transformFlightDatesResponse(
          data,
          params.origin,
          params.destination,
        );
      }

      // If error, return empty data (no fallback)
      const errorText = await response.text();
      console.log(
        `Flight Cheapest Date Search failed (${response.status}): ${errorText}`,
      );
      return {
        data: {},
        meta: {
          origin: params.origin,
          destination: params.destination,
          source: "flight-dates-api",
          error: `Route not in cache (${response.status})`,
        },
      };
    } catch (error) {
      console.error("Error fetching flight dates:", error);
      return {
        data: {},
        meta: {
          origin: params.origin,
          destination: params.destination,
          error: String(error),
        },
      };
    }
  },

  // Transform Flight Cheapest Date Search API response to frontend format
  transformFlightDatesResponse(
    apiResponse: {
      data: Array<{
        type: string;
        origin: string;
        destination: string;
        departureDate: string;
        returnDate?: string;
        price: { total: string };
      }>;
    },
    origin: string,
    destination: string,
  ) {
    const priceData: Record<
      string,
      { price: number; isCheapest: boolean; isRecommended: boolean }
    > = {};
    const dates: string[] = [];

    if (!apiResponse.data || apiResponse.data.length === 0) {
      return {
        data: priceData,
        meta: { dates, origin, destination, source: "flight-dates-api" },
      };
    }

    // Extract prices from response
    const pricesWithDates = apiResponse.data.map((item) => ({
      date: item.departureDate,
      price: parseFloat(item.price.total),
    }));

    // Calculate thresholds for cheapest/recommended
    const validPrices = pricesWithDates.map((p) => p.price);
    const minPrice = Math.min(...validPrices);
    const maxPrice = Math.max(...validPrices);
    const priceRange = maxPrice - minPrice;
    const cheapestThreshold = minPrice + priceRange * 0.15;
    const recommendedThreshold = minPrice + priceRange * 0.35;

    // Build price data object
    pricesWithDates.forEach(({ date, price }) => {
      dates.push(date);
      const isCheapest = price <= cheapestThreshold;
      const isRecommended = !isCheapest && price <= recommendedThreshold;

      priceData[date] = {
        price: Math.round(price),
        isCheapest,
        isRecommended,
      };
    });

    return {
      data: priceData,
      meta: {
        dates,
        origin,
        destination,
        source: "flight-dates-api",
        count: dates.length,
      },
    };
  },
};
