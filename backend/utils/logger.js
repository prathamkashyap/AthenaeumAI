import winston from "winston";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logsDir = path.join(__dirname, "..", "logs");

const { combine, timestamp, printf, colorize, errors, json } = winston.format;

// Custom text format for development / console output
const devFormat = printf(({ level, message, timestamp, stack, requestId, userId, route, ...metadata }) => {
  let log = `[${timestamp}] [${level}]`;
  if (requestId) log += ` [Req: ${requestId}]`;
  if (userId) log += ` [User: ${userId}]`;
  if (route) log += ` [Route: ${route}]`;
  log += `: ${stack || message}`;
  
  if (Object.keys(metadata).length > 0 && message !== stack) {
    // If metadata contains memory string
    const metaString = JSON.stringify(metadata);
    log += ` | Meta: ${metaString}`;
  }
  return log;
});

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: combine(
    timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
    errors({ stack: true }),
    winston.format((info) => {
      // Append memory usage optionally for heavily processed logs
      info.memory = `${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`;
      return info;
    })(),
    json()
  ),
  transports: [
    // combined logs file
    new winston.transports.File({
      filename: path.join(logsDir, "app.log"),
      level: "info",
    }),
    // error logs file
    new winston.transports.File({
      filename: path.join(logsDir, "error.log"),
      level: "error",
    }),
  ],
  exceptionHandlers: [
    new winston.transports.File({ filename: path.join(logsDir, "exceptions.log") }),
  ],
  rejectionHandlers: [
    new winston.transports.File({ filename: path.join(logsDir, "rejections.log") }),
  ],
});

// If we are in development mode, log to console with colored text format
if (process.env.NODE_ENV !== "production") {
  logger.add(
    new winston.transports.Console({
      format: combine(
        colorize(),
        timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
        errors({ stack: true }),
        devFormat
      ),
    })
  );
}

export default logger;
