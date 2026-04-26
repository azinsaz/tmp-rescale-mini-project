# ─── deps stage ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# ─── src stage (deps + source, no build — used by vitest) ────────────────────
FROM deps AS src
COPY . .

# ─── builder stage ───────────────────────────────────────────────────────────
FROM src AS builder
RUN npm run build

# ─── runtime stage ───────────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
