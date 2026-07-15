# Troubleshooting Guide

This guide covers common issues and resolutions when running AthenaeumAI locally.

---

## 💾 Database Issues

### MongoDB Not Connected or Unavailable
If the application displays "Database may be unavailable" or "Couldn't load quiz history", it means the local MongoDB instance is not running or not accessible.

**Resolution Steps:**
1. Check if MongoDB is running locally:
   - On macOS (Homebrew):
     ```bash
     brew services list
     ```
     Ensure `mongodb-community` status is `started`. If not, start it:
     ```bash
     brew services start mongodb-community
     ```
   - On Linux/Windows:
     Verify the `mongod` service state.

2. Verify connectivity with Mongo Shell:
   ```bash
   mongosh
   ```
   Once connected, run:
   ```bash
   show dbs
   ```

3. Environment Configuration:
   Verify `MONGODB_URI` exists in `backend/.env`. The default is:
   ```env
   MONGODB_URI=mongodb://localhost:27017/athenaeum
   ```

---

## 🔌 Port Conflicts

If the backend server or frontend dev server fails to bind to ports:
- Port `3001` (Backend)
- Port `8080` (Frontend)

**Resolution Steps:**
1. Find the processes occupying the ports:
   ```bash
   lsof -i :3001
   lsof -i :8080
   ```
2. Kill the conflicting processes:
   ```bash
   kill -9 <PID>
   ```

---

## 🔑 Environment Variables
The backend requires environment variables to validate and boot correctly. Check `backend/.env` for:
- `JWT_SECRET`: signing JWT sessions.
- `MONGODB_URI`: database connections.
- `GROQ_API_KEY`: accessing Groq LLM services for quiz and tutoring actions.

---

## 🌱 Seeder Issues
If `npm run seed:demo` fails:
1. Ensure MongoDB is running and writable.
2. If duplicate key errors are reported, run the seeder again; it will clean up old records automatically via `.deleteMany({})`.
3. Check the seeder log output. The expected summary is:
   ```text
   🌱 Starting Enhanced AthenaeumAI Demo Seeding...
   🗑️ Cleaning database collections...
   👤 Seeding demo user...
   📁 Seeding study materials...
   📄 Seeding chunks...
   🧠 Seeding quizzes...
   📊 Seeding quiz attempts...
   🃏 Seeding flashcard sets...
   📈 Seeding user progress...
   📥 Seeding review queue items...
   📋 Seeding tutor logs...
   🎉 AthenaeumAI Enhanced Demo Seeding completed successfully!
   ```
