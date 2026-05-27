FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --production

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Expose port
EXPOSE 3000

# Set environment defaults
ENV NODE_ENV=production
ENV API_PORT=3000

# Start server
CMD ["node", "dist/api/server.js"]
