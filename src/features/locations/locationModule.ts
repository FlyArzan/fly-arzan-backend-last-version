import { Hono } from "hono";
import { locationService } from "./locationService.js";
import { validateInput } from "@/lib/validateInput.js";
import { object, string } from "yup";
import { paginationQuerySchema } from "@/schema/paginationSchema.js";

const app = new Hono();

/*
  @route    GET: /locations/countries
  @access   public
  @desc     Full ISO country list (iso, name) for admin country pickers
*/
app.get("/countries", async (c) => {
  const countries = await locationService.getCountryList();
  return c.json(countries);
});

/*
  @route    GET: /locations/primary-airport
  @access   public
  @desc     Best-guess primary airport (capital city, else largest) for a country.
            Tries the ISO-2 country code first, then falls back to matching by
            country name (the code on a visa record isn't always strict ISO-3166).
*/
app.get("/primary-airport", async (c) => {
  const countryCode = c.req.query("countryCode");
  const countryName = c.req.query("countryName");
  if (!countryCode && !countryName) {
    return c.json({ message: "countryCode or countryName is required" }, 400);
  }
  const result = await locationService.getPrimaryAirportForCountry(countryCode, countryName);
  if (!result) {
    return c.json({ message: "No airport found for this country" }, 404);
  }
  return c.json(result);
});

/*
  @route    GET: /locations
  @access   private
  @desc     Get city locations (With airports, countries, iataCode, etc)
*/
app.get("/", async (c) => {
  // Validate Query
  const validatedQuery = await validateInput({
    type: "query",
    schema: object({
      keyword: string().required(),
    }).concat(paginationQuerySchema),
    data: c.req.query(),
  });

  const { keyword, ...pagination } = validatedQuery;

  const result = await locationService.getLocations(keyword, pagination);
  return c.json(result);
});

export default app;
