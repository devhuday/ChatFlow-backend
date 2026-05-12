
# ---- Etapa 1: Build ----
# Instala TODAS las deps (incluyendo dev) para poder generar el cliente de Prisma
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
# Elimina las devDependencies en esta misma etapa
# No generamos el cliente aquí, ya que no tenemos las variables de entorno.

# ---- Etapa 2: Producción ----
# Parte de una imagen limpia y copia solo lo necesario desde el builder
FROM node:20-alpine AS production

WORKDIR /app

# Copiamos los artefactos de la etapa de build, incluyendo node_modules completo
# ya que el CMD necesita `prisma` que es una devDependency.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src ./src
COPY --from=builder /app/index.js ./index.js
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma.config.* ./

EXPOSE 3000
# Al iniciar, nos aseguramos que la BD esté al día, que el cliente de Prisma esté generado y luego arrancamos el servidor
CMD ["sh", "-c", "npx prisma db push && npx prisma generate && node index.js"]
