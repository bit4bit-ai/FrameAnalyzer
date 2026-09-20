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

# Replace default Nginx configuration with our unprivileged standalone config
COPY nginx.conf /etc/nginx/nginx.conf

# Copy compiled assets from builder
COPY --from=builder --chown=1000:1000 /app/dist /usr/share/nginx/html

# Grant permissions to user 1000
RUN chown -R 1000:1000 /usr/share/nginx/html /var/log/nginx && \
    chmod -R 755 /usr/share/nginx/html

USER 1000

# Hugging Face Spaces expects traffic on port 7860
EXPOSE 7860

CMD ["nginx", "-g", "daemon off;"]
