# Stage 1: Build Vite React application
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package descriptors and install dependencies
COPY package*.json ./
RUN npm ci || npm install

# Copy application source code and build production bundle
COPY . .
RUN npm run build

# Stage 2: Serve with lightweight Nginx (Hugging Face Spaces compatible)
FROM nginx:alpine

# Hugging Face Spaces runs containers with UID 1000
RUN adduser -D -u 1000 appuser

# Copy custom Nginx configuration for port 7860 & SPA routing
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Redirect PID file to /tmp and set permissions for unprivileged execution
RUN sed -i 's|/var/run/nginx.pid|/tmp/nginx.pid|g' /etc/nginx/nginx.conf && \
    mkdir -p /var/cache/nginx /var/log/nginx /usr/share/nginx/html && \
    chown -R 1000:1000 /var/cache/nginx /var/log/nginx /usr/share/nginx/html /etc/nginx/conf.d

# Copy compiled assets from builder
COPY --from=builder --chown=1000:1000 /app/dist /usr/share/nginx/html

USER 1000

# Hugging Face Spaces expects traffic on port 7860
EXPOSE 7860

CMD ["nginx", "-g", "daemon off;"]
