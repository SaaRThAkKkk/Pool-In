import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_DAYS: z.coerce.number().int().positive().default(7),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
  // Optional: comma-separated DNS servers for Node (fixes mongodb+srv lookups on networks whose DNS rejects SRV queries)
  DNS_SERVERS: z.string().optional(),
  SMS_PROVIDER: z.enum(['console']).default('console'),
  // When true, users with an unverified phone are blocked from booking/joining rides. Off for now.
  REQUIRE_VERIFIED_PHONE_FOR_BOOKING: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  ENABLE_PAID_PRIVATE_RIDES: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
}).refine((e) => !(e.NODE_ENV === 'production' && e.SMS_PROVIDER === 'console'), {
  path: ['SMS_PROVIDER'],
  message: 'the console SMS provider is development-only; configure a real SMS provider for production',
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  return parsed.data;
}
