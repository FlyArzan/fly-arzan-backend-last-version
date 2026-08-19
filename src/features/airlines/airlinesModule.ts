import { Hono } from "hono";
import type { Context } from "hono";
import { prisma } from "@/lib/prisma.js";
import { requireAdmin } from "@/lib/auth.js";

const app = new Hono();

/**
 * Airline reference lookup.
 *
 * The `airline` table is populated by src/import-data.ts from
 * airline_iata_icao_codes.json but had no route exposing it. The admin airport
 * form needs it to autocomplete "which airlines serve this airport": the editor
 * types a name or code, picks a match, and we fill in the IATA code (which in
 * turn resolves the logo at /logos/<IATA>.png on the public side) plus website.
 *
 * Admin-only — this is an authoring aid, not public data.
 */

const SEARCH_LIMIT = 20;

const toAirlineOption = (airline: {
  id: number;
  name: string;
  iata: string | null;
  icao: string | null;
  website: string | null;
  countryIso: string;
  country?: { name: string } | null;
}) => ({
  id: airline.id,
  name: airline.name,
  iata: airline.iata || "",
  icao: airline.icao || "",
  website: airline.website || "",
  countryIso: airline.countryIso,
  countryName: airline.country?.name || "",
});

// Autocomplete airlines by name, IATA or ICAO code.
app.get("/search", requireAdmin, async (c: Context) => {
  const q = (c.req.query("q") || "").trim();
  if (q.length < 2) return c.json({ airlines: [] });

  const select = {
    id: true,
    name: true,
    iata: true,
    icao: true,
    website: true,
    countryIso: true,
    country: { select: { name: true } },
  } as const;

  // An exact code match is almost always what the editor meant, so surface it
  // first rather than letting it sort alphabetically into the middle.
  //
  // This is Postgres: `contains`/`equals` are case-sensitive unless told
  // otherwise, so every filter sets mode "insensitive" (same as the airports,
  // articles and visa modules).
  const code = q.toUpperCase();
  const insensitive = "insensitive" as const;
  const [exact, matches] = await Promise.all([
    code.length === 2 || code.length === 3
      ? prisma.airline.findFirst({
          where: {
            OR: [
              { iata: { equals: code, mode: insensitive } },
              { icao: { equals: code, mode: insensitive } },
            ],
          },
          select,
        })
      : Promise.resolve(null),
    prisma.airline.findMany({
      where: {
        OR: [
          { name: { contains: q, mode: insensitive } },
          { iata: { contains: code, mode: insensitive } },
          { icao: { contains: code, mode: insensitive } },
        ],
      },
      select,
      orderBy: { name: "asc" },
      take: SEARCH_LIMIT,
    }),
  ]);

  const ordered = exact
    ? [exact, ...matches.filter((m) => m.id !== exact.id)]
    : matches;

  return c.json({ airlines: ordered.slice(0, SEARCH_LIMIT).map(toAirlineOption) });
});

export default app;
