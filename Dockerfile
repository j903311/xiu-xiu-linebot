# Use official Node.js LTS image
FROM node:18

# Set working directory
WORKDIR /app

# Copy package files first (better caching)
COPY package.json ./

# Force install latest Google Generative AI SDK
RUN npm install @google/generative-ai@latest --force

# Install other deps (ignore package-lock to avoid old lock issues)
RUN rm -f package-lock.json && npm install --force

# Copy rest of the app
COPY . .

# Expose default port
EXPOSE 8080

# Start command
CMD ["npm", "run", "start"]
