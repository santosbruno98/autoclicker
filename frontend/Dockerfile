# Stage 1: Build React app
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package configs and install dependencies
COPY package*.json ./
RUN npm install

# Copy source code and build
COPY . .
RUN npm run build

# Stage 2: Serve static files with Nginx
FROM nginx:alpine

# Clear default Nginx static files
RUN rm -rf /usr/share/nginx/html/*

# Copy Vite build output to Nginx root directory
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy custom Nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]