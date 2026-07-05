FROM node:18-alpine

# Set the working directory inside the container
WORKDIR /app

# Copy the backend package.json and package-lock.json
COPY backend/package*.json ./backend/

# Install backend dependencies
RUN cd backend && npm install --production

# Copy the rest of the application files
COPY . .

# Expose the port the app runs on
EXPOSE 3000

# Start the Node.js server
CMD ["node", "backend/server.js"]
