FROM ghcr.io/puppeteer/puppeteer:latest

USER root

# Set working directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies (skipping dev dependencies)
RUN npm ci --only=production

# Copy application source code
COPY . .

# Expose server port
EXPOSE 7000

# Start command
CMD ["node", "src/server.js"]
