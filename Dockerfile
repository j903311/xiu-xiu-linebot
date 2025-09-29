# Use official Node.js LTS image
FROM node:18

# Set working directory
WORKDIR /app

# Copy package files first (better caching)
COPY package.json ./

# Clean lock file if exists, then install fresh deps
RUN rm -f package-lock.json && npm install --force

# Copy rest of the app
COPY . .

# Expose default port
EXPOSE 8080

# Start command
CMD ["npm", "run", "start"]
