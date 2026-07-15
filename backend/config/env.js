import dotenv from "dotenv";
import { z } from "zod";

// Load environment variables
dotenv.config();

const envSchema = z.object({
  GROQ_API_KEY: z.string({
    required_error: "GROQ_API_KEY is required for AI quiz generation and tutoring.",
  }).min(1, "GROQ_API_KEY cannot be empty."),
  
  MONGODB_URI: z.string({
    required_error: "MONGODB_URI is required to establish database persistence.",
  }).min(1, "MONGODB_URI cannot be empty."),
  
  JWT_SECRET: z.string({
    required_error: "JWT_SECRET is required to sign and verify session tokens.",
  }).min(8, "JWT_SECRET must be at least 8 characters long."),
  
  PORT: z.preprocess(
    (val) => (val ? parseInt(val, 10) : 3001),
    z.number().positive().max(65535)
  ).default(3001),
  
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

// Run validation
const parseResult = envSchema.safeParse(process.env);

if (!parseResult.success) {
  console.error("\n❌ Environment configuration validation failed:");
  parseResult.error.issues.forEach((issue) => {
    console.error(`   - ${issue.path.join(".")}: ${issue.message}`);
  });
  console.error("\nPlease check your backend/.env file and restart the server.\n");
  process.exit(1);
}

export const env = parseResult.data;
export default env;
