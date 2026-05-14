import dotenv from "dotenv";
dotenv.config({ override: !process.env.RAILWAY_SERVICE_ID });
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();
