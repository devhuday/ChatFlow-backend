
import { defineConfig } from '@prisma/config';
import dotenv from 'dotenv';

// Forzar la carga de las variables de entorno
dotenv.config();

export default defineConfig({
  datasource: {
    url: process.env.DATABASE_URL || "postgresql://bot_wp:bot_wp_password@127.0.0.1:5432/bot_wp_db?schema=public",
  },
});
