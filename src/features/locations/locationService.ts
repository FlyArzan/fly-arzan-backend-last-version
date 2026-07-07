import { prisma } from "@/lib/prisma.js";
import { getPaginationQuery } from "@/lib/pagination.js";
import type { PaginationQuery } from "@/schema/paginationSchema.js";

type PrimaryAirportResult = { city: string; iataCode: string } | null;

export const locationService = {
  // Full ISO country list (iso, name), sorted by name — used to power a
  // validated country picker in admin forms so a country's stored code is
  // always a real ISO 3166-1 alpha-2 code, never free-typed.
  async getCountryList() {
    const countries = await prisma.country.findMany({
      select: { iso: true, name: true },
      orderBy: { name: "asc" },
    });
    return countries;
  },

  // Best-guess primary airport for a country: prefer a large/medium airport in
  // the capital city, else the biggest scheduled airport anywhere in the
  // country. Used to prefill the flight search "To" field from a visa page's
  // "Search Flights to X" CTA, where we only have a country, not a city.
  //
  // A visa record's countryCode is free-typed by an admin and isn't always
  // strict ISO 3166-1 (e.g. "UK" instead of the real code "GB"), so if the
  // code doesn't resolve, fall back to matching by country name — which tends
  // to be entered consistently and lines up with this DB's `country.name`.
  async getPrimaryAirportForCountry(
    countryCode?: string,
    countryName?: string,
  ): Promise<PrimaryAirportResult> {
    let country = countryCode
      ? await prisma.country.findUnique({ where: { iso: countryCode.toUpperCase() } })
      : null;

    if (!country && countryName) {
      country = await prisma.country.findFirst({
        where: { name: { equals: countryName, mode: "insensitive" } },
      });
    }

    if (!country) return null;

    const sizePriority = ["large_airport", "medium_airport"] as const;

    if (country.capital) {
      const capitalCity = await prisma.city.findFirst({
        where: { countryIso: country.iso, name: { equals: country.capital, mode: "insensitive" } },
      });
      if (capitalCity) {
        for (const type of sizePriority) {
          const airport = await prisma.airport.findFirst({
            where: { cityId: capitalCity.id, type, iataCode: { not: null } },
          });
          if (airport?.iataCode) return { city: capitalCity.name, iataCode: airport.iataCode };
        }
      }
    }

    // Fallback: the biggest scheduled airport anywhere in the country.
    for (const type of sizePriority) {
      const airport = await prisma.airport.findFirst({
        where: { type, iataCode: { not: null }, city: { countryIso: country.iso } },
        include: { city: true },
      });
      if (airport?.iataCode) return { city: airport.city.name, iataCode: airport.iataCode };
    }

    return null;
  },

  async getLocations(keyword: string, pagination: PaginationQuery) {
    const { skip, take, page, limit } = getPaginationQuery(pagination);

    const airports = await prisma.airport.findMany({
      where: {
        OR: [
          {
            iataCode: {
              contains: keyword,
              mode: "insensitive",
            },
          },
          {
            city: {
              name: {
                contains: keyword,
                mode: "insensitive",
              },
            },
          },
        ],
      },
      skip,
      take,
      include: {
        city: {
          include: {
            country: true,
          },
        },
      },
    });

    const total = await prisma.airport.count({
      where: {
        OR: [
          {
            iataCode: {
              contains: keyword,
              mode: "insensitive",
            },
          },
          {
            city: {
              name: {
                contains: keyword,
                mode: "insensitive",
              },
            },
          },
        ],
      },
    });

    return {
      meta: {
        total,
        page,
        limit,
      },
      data: airports.map((airport) => ({
        city: airport.city.name,
        country: airport.city.country.name,
        airport: airport.name,
        iataCode: airport.iataCode,
        lat: airport.latitudeDeg,
        lang: airport.longitudeDeg,
      })),
    };
  },
};
