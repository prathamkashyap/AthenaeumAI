# Deployment & Execution Guide

This document describes how to configure environment variables and execute the client and server applications.

---

## 🔑 Environment Variables

The server process expects a `.env` file inside the `backend/` directory:

| Key | Description | Example / Default | Required |
|---|---|---|---|
| `GROQ_API_KEY` | Developer key for Groq API console | `gsk_...` | Yes |
| `MONGODB_URI` | Connection URI for the MongoDB instance | `mongodb://localhost:27017/athenaeum` | Yes |
| `JWT_SECRET` | Secret key for signing JSON Web Tokens | `a_long_secure_secret_hash_here` | Yes |
| `PORT` | Local port for the Express backend server | `3001` | No (default: 3001) |
| `NODE_ENV` | Target operational environment | `development` | No (default: `development`) |

---

## 🚀 Local Run Commands

### 1. Backend Server Setup
Navigate into the `backend/` directory, install packages, and boot the server in hot-reload development mode:
```bash
cd backend
npm install
npm run dev
```

### 2. Frontend Client Setup
Open a separate terminal window, navigate into the project root directory, install npm modules, and start Vite's HMR compiler:
```bash
# In project root
npm install
npm run dev
```
The client dashboard compiles and launches on [http://localhost:5173](http://localhost:5173).

---

## 📦 Production Hardening
To bundle the frontend application for production deployment:
```bash
npm run build
```
This generates static client assets under the `dist/` directory. These can be served directly from a static hosting provider (e.g., Vercel, Netlify) or proxied through an Nginx proxy serving the Express server backend.
