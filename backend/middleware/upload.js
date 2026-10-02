import fs from "fs";
import multer from "multer";
import path from "path";

// Where uploads are written. Relative, so it resolves against the process working
// directory exactly as before.
const UPLOAD_DIR = "uploads/";

// multer's diskStorage does not create its destination, and a checkout has no
// `uploads/` directory: it holds user-supplied PDFs and is deliberately not
// committed. Without this, the first upload of a fresh install fails with ENOENT
// before any application logic runs. Created here so the storage location itself
// needs no change.
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const fileFilter = (req, file, cb) => {
  const allowed = [
    "application/pdf",
    "text/plain",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ];

  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Only PDF, TXT, and DOCX files are supported"), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
  },
});

export default upload;
