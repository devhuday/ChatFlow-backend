
import { defineConfig, env } from '@prisma/config';
import 'dotenv/config'; // <-- Esto fuerza la lectura de tu archivo .env

export default defineConfig({
  datasource: {
    url: env('DATABASE_URL'),
  }
});

