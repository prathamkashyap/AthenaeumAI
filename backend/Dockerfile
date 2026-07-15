FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy the rest of the backend code
COPY . .

EXPOSE 5000

# Use nodemon for development auto-reload, or node for prod
CMD ["npm", "run", "dev"]
