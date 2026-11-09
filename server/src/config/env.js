
import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().default(5050),
  MONGO_URI: z.string().min(1),
  JWT_SECRET: z.string().min(16),
  MANDATE_SECRET: z.string().min(16).optional(),
  CLIENT_URL: z.string().default('http://localhost:5173'),

  PAYPAL_CLIENT_ID: z.string().min(1),
  PAYPAL_CLIENT_SECRET: z.string().min(1),
  PAYPAL_BASE_URL: z.string().default('https://api-m.sandbox.paypal.com'),

  // Gemini AI configuration
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),

  DEMO_MODE: z.string().default('true'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error(
    'Invalid environment:',
    parsed.error.flatten().fieldErrors
  );
  process.exit(1);
}

export const env = {
  ...parsed.data,
  MANDATE_SECRET: parsed.data.MANDATE_SECRET || parsed.data.JWT_SECRET,
  demo: parsed.data.DEMO_MODE === 'true',
};
