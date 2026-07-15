FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy the rest of the frontend code
COPY . .

EXPOSE 8080

# Start Vite in dev mode and expose host
CMD ["npm", "run", "dev", "--", "--host"]
