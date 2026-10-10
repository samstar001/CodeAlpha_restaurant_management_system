// Use a SEPARATE database for tests so real data is never touched
import dotenv from "dotenv";
dotenv.config({ path: ".env.test", quiet: true });
