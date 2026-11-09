import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';
import { env } from './config/env.js';
import routes from './routes/index.js';
import { errorHandler } from './middleware/error.middleware.js';

const app = express();
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: env.CLIENT_URL.split(',') }));
app.use(express.json({ limit: '50kb' }));
app.use('/api/auth', rateLimit({ windowMs: 15 * 60_000, limit: 50 }));
app.use('/api', rateLimit({ windowMs: 60_000, limit: 120 }));
app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/api', routes);
app.use(errorHandler);

await mongoose.connect(env.MONGO_URI);
app.listen(env.PORT, () => console.log(`IntentLock API on :${env.PORT} (PayPal ${env.PAYPAL_BASE_URL})`));
