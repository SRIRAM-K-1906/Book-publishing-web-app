const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const admin = require('firebase-admin');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'rps_secret_jwt_sign_key_987654321';

// Configure directories
const pdfsDir = path.join(__dirname, 'uploads', 'pdfs');
const coversDir = path.join(__dirname, 'public', 'uploads', 'covers');

if (!fs.existsSync(pdfsDir)) {
  fs.mkdirSync(pdfsDir, { recursive: true });
}
if (!fs.existsSync(coversDir)) {
  fs.mkdirSync(coversDir, { recursive: true });
}

// Initialize Firebase Admin
let db;
let firebaseInitialized = false;

const serviceAccountPath = path.join(__dirname, 'service-account.json');
if (fs.existsSync(serviceAccountPath)) {
  try {
    const serviceAccount = require(serviceAccountPath);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: process.env.FIREBASE_DATABASE_URL
    });
    db = admin.database();
    firebaseInitialized = true;
    console.log("Firebase Admin SDK initialized successfully.");
  } catch (error) {
    console.error("Error initializing Firebase Admin with service-account.json:", error);
  }
} else {
  console.warn("==========================================================================");
  console.warn("WARNING: service-account.json not found in the root directory!");
  console.warn("Falling back to a local JSON database (local_db.json) for development.");
  console.warn("==========================================================================");
}

// Local Database Fallback (if Firebase is not initialized)
const localDbPath = path.join(__dirname, 'local_db.json');
function readLocalDb() {
  if (!fs.existsSync(localDbPath)) {
    const initialDb = {
      admins: {},
      users: {},
      passwordResets: {},
      books: {},
      categories: {
        "Story": true,
        "Science": true,
        "Technology": true,
        "Education": true,
        "Novel": true
      },
      purchases: {},
      payments: {}
    };
    fs.writeFileSync(localDbPath, JSON.stringify(initialDb, null, 2));
    return initialDb;
  }
  try {
    return JSON.parse(fs.readFileSync(localDbPath, 'utf8'));
  } catch (e) {
    return {};
  }
}

function writeLocalDb(data) {
  fs.writeFileSync(localDbPath, JSON.stringify(data, null, 2));
}

// Database Helper Functions (Abstracting Firebase / Local DB)
const dbHelper = {
  get: async (pathStr) => {
    if (firebaseInitialized) {
      const snapshot = await db.ref(pathStr).once('value');
      return snapshot.val();
    } else {
      const localDb = readLocalDb();
      const parts = pathStr.split('/').filter(Boolean);
      let current = localDb;
      for (const part of parts) {
        if (!current || typeof current !== 'object') return null;
        current = current[part];
      }
      return current || null;
    }
  },
  set: async (pathStr, val) => {
    if (firebaseInitialized) {
      await db.ref(pathStr).set(val);
    } else {
      const localDb = readLocalDb();
      const parts = pathStr.split('/').filter(Boolean);
      let current = localDb;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!current[parts[i]]) current[parts[i]] = {};
        current = current[parts[i]];
      }
      current[parts[parts.length - 1]] = val;
      writeLocalDb(localDb);
    }
  },
  push: async (pathStr, val) => {
    if (firebaseInitialized) {
      const ref = db.ref(pathStr).push();
      await ref.set({ ...val, id: ref.key });
      return ref.key;
    } else {
      const localDb = readLocalDb();
      const parts = pathStr.split('/').filter(Boolean);
      let current = localDb;
      for (const part of parts) {
        if (!current[part]) current[part] = {};
        current = current[part];
      }
      const newKey = 'id_' + Math.random().toString(36).substr(2, 9);
      current[newKey] = { ...val, id: newKey };
      writeLocalDb(localDb);
      return newKey;
    }
  },
  update: async (pathStr, val) => {
    if (firebaseInitialized) {
      await db.ref(pathStr).update(val);
    } else {
      const localDb = readLocalDb();
      const parts = pathStr.split('/').filter(Boolean);
      let current = localDb;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!current[parts[i]]) current[parts[i]] = {};
        current = current[parts[i]];
      }
      const target = current[parts[parts.length - 1]] || {};
      current[parts[parts.length - 1]] = { ...target, ...val };
      writeLocalDb(localDb);
    }
  },
  remove: async (pathStr) => {
    if (firebaseInitialized) {
      await db.ref(pathStr).remove();
    } else {
      const localDb = readLocalDb();
      const parts = pathStr.split('/').filter(Boolean);
      let current = localDb;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!current[parts[i]]) return;
        current = current[parts[i]];
      }
      delete current[parts[parts.length - 1]];
      writeLocalDb(localDb);
    }
  }
};

// Seed Fixed Admin Account on startup
async function seedAdmin() {
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@rpsbookstore.com';
  const adminPassword = process.env.ADMIN_PASSWORD || 'AdminPassWord123!';
  
  const admins = await dbHelper.get('admins');
  let adminExists = false;
  
  if (admins) {
    adminExists = Object.values(admins).some(a => a.email === adminEmail);
  }
  
  if (!adminExists) {
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(adminPassword, salt);
    await dbHelper.set('admins/fixed_admin', {
      email: adminEmail,
      passwordHash: passwordHash
    });
    console.log(`Seed Admin account created successfully: ${adminEmail}`);
  }
}
seedAdmin().catch(console.error);

// Seed Categories if not exist
async function seedCategories() {
  const categories = await dbHelper.get('categories');
  if (!categories || Object.keys(categories).length === 0) {
    const defaultCategories = {
      "Story": true,
      "Science": true,
      "Technology": true,
      "Education": true,
      "Novel": true
    };
    await dbHelper.set('categories', defaultCategories);
    console.log("Default categories pre-seeded.");
  }
}
seedCategories().catch(console.error);


// Middleware configuration
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Authentication Middlewares
const verifyUserToken = async (req, res, next) => {
  const token = req.cookies.token;
  if (!token) {
    return res.status(401).json({ message: "Authentication token missing. Please sign in." });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    
    // Double check user exists in DB
    const user = await dbHelper.get(`users/${decoded.userId}`);
    if (!user) {
      return res.status(404).json({ message: "User account not found." });
    }
    next();
  } catch (error) {
    return res.status(403).json({ message: "Invalid or expired token." });
  }
};

const verifyAdminToken = async (req, res, next) => {
  const adminToken = req.cookies.admin_token;
  if (!adminToken) {
    return res.status(401).json({ message: "Access denied. Admin authorization missing." });
  }
  try {
    const decoded = jwt.verify(adminToken, JWT_SECRET);
    if (decoded.role !== 'admin') {
      return res.status(403).json({ message: "Forbidden. Admin role required." });
    }
    req.admin = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ message: "Invalid or expired admin token." });
  }
};

const verifyUserOrAdminToken = async (req, res, next) => {
  const token = req.cookies.token;
  const adminToken = req.cookies.admin_token;
  
  if (adminToken) {
    try {
      const decoded = jwt.verify(adminToken, JWT_SECRET);
      if (decoded.role === 'admin') {
        req.admin = decoded;
        req.userRole = 'admin';
        return next();
      }
    } catch (e) {}
  }
  
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded;
      req.userRole = 'user';
      return next();
    } catch (e) {}
  }
  
  return res.status(401).json({ message: "Access unauthorized." });
};

// Multer storage setup
const fileStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.fieldname === 'cover') {
      cb(null, coversDir);
    } else if (file.fieldname === 'pdf') {
      cb(null, pdfsDir);
    } else {
      cb(new Error('Invalid fieldname'), null);
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  if (file.fieldname === 'cover') {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Cover must be an image file!'), false);
    }
  } else if (file.fieldname === 'pdf') {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Book file must be a PDF!'), false);
    }
  } else {
    cb(new Error('Unknown field'), false);
  }
};

const upload = multer({
  storage: fileStorage,
  fileFilter: fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 } // Limit files to 50MB
});

// Helper: PayPal Authorization
async function getPayPalAccessToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_SECRET;
  const apiUrl = process.env.PAYPAL_API_URL || 'https://api-m.sandbox.paypal.com';

  if (!clientId || !secret || clientId === 'placeholder_paypal_client_id') {
    throw new Error("PayPal Client ID or Secret is not configured in .env file.");
  }

  const auth = Buffer.from(`${clientId}:${secret}`).toString('base64');
  const response = await fetch(`${apiUrl}/v1/oauth2/token`, {
    method: 'POST',
    body: 'grant_type=client_credentials',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`PayPal Auth Error: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  return data.access_token;
}


// ==========================================
//                 API ROUTES
// ==========================================

// 1. Auth Router
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ message: "All fields are required." });
  }

  try {
    const users = await dbHelper.get('users');
    if (users) {
      const emailExists = Object.values(users).some(u => u.email.toLowerCase() === email.toLowerCase());
      if (emailExists) {
        return res.status(400).json({ message: "Email is already registered." });
      }
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    const userId = 'usr_' + Math.random().toString(36).substr(2, 9);
    
    const newUser = {
      userId,
      name,
      email: email.toLowerCase(),
      passwordHash,
      authProvider: 'email',
      registrationDate: new Date().toISOString()
    };

    await dbHelper.set(`users/${userId}`, newUser);

    // Generate token and login automatically
    const token = jwt.sign({ userId, name, email: newUser.email, role: 'user' }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('token', token, {
      httpOnly: true,
      secure: false, // Set to true if HTTPS
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    const { passwordHash: _, ...userResp } = newUser;
    return res.status(201).json({ message: "User registered successfully", user: userResp });
  } catch (error) {
    console.error("Register Error:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required." });
  }

  try {
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@rpsbookstore.com';
    
    // Check if it's the admin logging in
    if (email.toLowerCase() === adminEmail.toLowerCase()) {
      const admins = await dbHelper.get('admins');
      let adminAccount = null;
      if (admins) {
        adminAccount = Object.values(admins).find(a => a.email.toLowerCase() === email.toLowerCase());
      }

      if (adminAccount) {
        const isMatch = await bcrypt.compare(password, adminAccount.passwordHash);
        if (isMatch) {
          const adminToken = jwt.sign({ email: adminAccount.email, role: 'admin' }, JWT_SECRET, { expiresIn: '1d' });
          res.clearCookie('token');
          res.cookie('admin_token', adminToken, {
            httpOnly: true,
            secure: false, // Set to true if HTTPS
            sameSite: 'lax',
            maxAge: 24 * 60 * 60 * 1000 // 1 day
          });
          return res.json({ message: "Logged in successfully", role: 'admin', user: { email: adminAccount.email } });
        }
      }
      return res.status(400).json({ message: "Invalid email or password." });
    }

    // Standard user login
    const users = await dbHelper.get('users');
    let user = null;
    if (users) {
      user = Object.values(users).find(u => u.email.toLowerCase() === email.toLowerCase());
    }

    if (!user || user.authProvider !== 'email') {
      return res.status(400).json({ message: "Invalid email or password." });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid email or password." });
    }

    const token = jwt.sign({ userId: user.userId, name: user.name, email: user.email, role: 'user' }, JWT_SECRET, { expiresIn: '7d' });
    res.clearCookie('admin_token');
    res.cookie('token', token, {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    const { passwordHash: _, ...userResp } = user;
    return res.json({ message: "Logged in successfully", role: 'user', user: userResp });
  } catch (error) {
    console.error("Login Error:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
});

app.post('/api/auth/google', async (req, res) => {
  const { idToken } = req.body;
  if (!idToken) {
    return res.status(400).json({ message: "Google ID Token is missing." });
  }

  try {
    const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`);
    if (!response.ok) {
      return res.status(400).json({ message: "Invalid Google ID Token." });
    }
    const payload = await response.json();
    
    if (payload.aud !== process.env.GOOGLE_CLIENT_ID) {
      return res.status(400).json({ message: "Google Client ID mismatch." });
    }

    const email = payload.email.toLowerCase();
    const name = payload.name;
    const googleId = payload.sub;

    let users = await dbHelper.get('users');
    let user = null;
    if (users) {
      user = Object.values(users).find(u => u.email.toLowerCase() === email);
    }

    if (!user) {
      const userId = 'usr_' + Math.random().toString(36).substr(2, 9);
      user = {
        userId,
        name,
        email,
        authProvider: 'google',
        googleId,
        registrationDate: new Date().toISOString()
      };
      await dbHelper.set(`users/${userId}`, user);
    }

    const token = jwt.sign({ userId: user.userId, name: user.name, email: user.email, role: 'user' }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('token', token, {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    return res.json({ message: "Logged in with Google successfully", user });
  } catch (error) {
    console.error("Google Auth Error:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
});

app.post('/api/auth/admin-login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required." });
  }

  try {
    const admins = await dbHelper.get('admins');
    let adminAccount = null;
    if (admins) {
      adminAccount = Object.values(admins).find(a => a.email.toLowerCase() === email.toLowerCase());
    }

    if (!adminAccount) {
      return res.status(400).json({ message: "Invalid admin credentials." });
    }

    const isMatch = await bcrypt.compare(password, adminAccount.passwordHash);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid admin credentials." });
    }

    const adminToken = jwt.sign({ email: adminAccount.email, role: 'admin' }, JWT_SECRET, { expiresIn: '1d' });
    res.cookie('admin_token', adminToken, {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000
    });

    return res.json({ message: "Logged in as Admin successfully", admin: { email: adminAccount.email } });
  } catch (error) {
    console.error("Admin Login Error:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
});

// Forgot Password API
app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ message: "Email address is required." });
  }

  try {
    const users = await dbHelper.get('users');
    let userExists = false;
    if (users) {
      userExists = Object.values(users).some(u => u.email.toLowerCase() === email.toLowerCase() && u.authProvider === 'email');
    }

    if (!userExists) {
      // Return success to prevent email verification scanning (security best practice)
      return res.json({ message: "If an account with that email exists, a password reset link has been logged to the server terminal. Please check the logs." });
    }

    const resetToken = crypto.randomBytes(24).toString('hex');
    const resetData = {
      email: email.toLowerCase(),
      expires: new Date(Date.now() + 3600000).toISOString() // 1 hour expiration
    };

    await dbHelper.set(`passwordResets/${resetToken}`, resetData);

    // Secure local reset logging
    console.log("\n==========================================================================");
    console.log(`🔒 PASSWORD RESET LINK REQUESTED FOR: ${email}`);
    console.log(`🔗 LINK: http://localhost:5000/reset-password.html?token=${resetToken}`);
    console.log("==========================================================================\n");

    return res.json({ message: "If an account with that email exists, a password reset link has been logged to the server terminal. Please check the logs." });
  } catch (error) {
    console.error("Forgot Password Error:", error);
    return res.status(500).json({ message: "Failed to generate password reset request." });
  }
});

// Reset Password API
app.post('/api/auth/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) {
    return res.status(400).json({ message: "Reset token and new password are required." });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ message: "Password must be at least 6 characters." });
  }

  try {
    const resetRequest = await dbHelper.get(`passwordResets/${token}`);
    if (!resetRequest) {
      return res.status(400).json({ message: "Invalid or expired password reset token." });
    }

    const isExpired = new Date() > new Date(resetRequest.expires);
    if (isExpired) {
      await dbHelper.remove(`passwordResets/${token}`);
      return res.status(400).json({ message: "Reset token has expired." });
    }

    const users = await dbHelper.get('users') || {};
    const userKey = Object.keys(users).find(key => users[key].email.toLowerCase() === resetRequest.email.toLowerCase());

    if (!userKey) {
      await dbHelper.remove(`passwordResets/${token}`);
      return res.status(404).json({ message: "User account not found." });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(newPassword, salt);

    // Update password in database
    await dbHelper.update(`users/${userKey}`, { passwordHash });
    
    // Invalidate reset token
    await dbHelper.remove(`passwordResets/${token}`);

    return res.json({ message: "Password reset successful! You can now log in with your new password." });
  } catch (error) {
    console.error("Reset Password Error:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.clearCookie('admin_token');
  return res.json({ message: "Logged out successfully." });
});

app.get('/api/auth/me', (req, res) => {
  const token = req.cookies.token;
  const adminToken = req.cookies.admin_token;

  if (adminToken) {
    try {
      const decoded = jwt.verify(adminToken, JWT_SECRET);
      if (decoded.role === 'admin') {
        return res.json({ authenticated: true, role: 'admin', user: { email: decoded.email } });
      }
    } catch (e) {}
  }

  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      return res.json({ authenticated: true, role: 'user', user: decoded });
    } catch (e) {}
  }

  return res.json({ authenticated: false });
});


// 2. Book Routes
app.get('/api/books', async (req, res) => {
  try {
    const books = await dbHelper.get('books');
    if (!books) return res.json([]);
    const bookList = Object.values(books).map(book => {
      const { pdfPath: _, ...bookPublic } = book;
      return bookPublic;
    });
    return res.json(bookList);
  } catch (error) {
    console.error("Get Books Error:", error);
    return res.status(500).json({ message: "Error loading books." });
  }
});

app.get('/api/books/:id', async (req, res) => {
  try {
    const book = await dbHelper.get(`books/${req.params.id}`);
    if (!book) {
      return res.status(404).json({ message: "Book not found." });
    }
    const { pdfPath: _, ...bookPublic } = book;
    return res.json(bookPublic);
  } catch (error) {
    console.error("Get Book Details Error:", error);
    return res.status(500).json({ message: "Error loading book details." });
  }
});

// Admin Add Book
app.post('/api/books', verifyAdminToken, (req, res) => {
  upload.fields([{ name: 'cover', maxCount: 1 }, { name: 'pdf', maxCount: 1 }])(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ message: err.message });
    }

    const { title, description, category, price } = req.body;
    
    if (!title || !description || !category || !price) {
      if (req.files['cover']) fs.unlinkSync(req.files['cover'][0].path);
      if (req.files['pdf']) fs.unlinkSync(req.files['pdf'][0].path);
      return res.status(400).json({ message: "Title, description, category, and price are required." });
    }

    if (!req.files['cover'] || !req.files['pdf']) {
      if (req.files['cover']) fs.unlinkSync(req.files['cover'][0].path);
      if (req.files['pdf']) fs.unlinkSync(req.files['pdf'][0].path);
      return res.status(400).json({ message: "Both a cover image and a PDF book file are required." });
    }

    try {
      const bookId = 'bk_' + Math.random().toString(36).substr(2, 9);
      
      const coverFilename = req.files['cover'][0].filename;
      const pdfFilename = req.files['pdf'][0].filename;

      const newBook = {
        bookId,
        title,
        description,
        category,
        price: parseFloat(price),
        coverUrl: `/uploads/covers/${coverFilename}`,
        pdfFilename,
        uploadDate: new Date().toISOString()
      };

      await dbHelper.set(`books/${bookId}`, newBook);
      return res.status(201).json({ message: "Book uploaded successfully.", book: newBook });
    } catch (error) {
      console.error("Add Book Error:", error);
      return res.status(500).json({ message: "Failed to save book." });
    }
  });
});

// Admin Edit Book
app.put('/api/books/:id', verifyAdminToken, (req, res) => {
  upload.fields([{ name: 'cover', maxCount: 1 }, { name: 'pdf', maxCount: 1 }])(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ message: err.message });
    }

    const bookId = req.params.id;
    const existingBook = await dbHelper.get(`books/${bookId}`);
    if (!existingBook) {
      if (req.files['cover']) fs.unlinkSync(req.files['cover'][0].path);
      if (req.files['pdf']) fs.unlinkSync(req.files['pdf'][0].path);
      return res.status(404).json({ message: "Book not found." });
    }

    const { title, description, category, price } = req.body;

    try {
      const updatedData = { ...existingBook };

      if (title) updatedData.title = title;
      if (description) updatedData.description = description;
      if (category) updatedData.category = category;
      if (price) updatedData.price = parseFloat(price);

      if (req.files['cover']) {
        const oldCoverFilename = existingBook.coverUrl.split('/').pop();
        const oldCoverPath = path.join(coversDir, oldCoverFilename);
        if (fs.existsSync(oldCoverPath)) {
          fs.unlinkSync(oldCoverPath);
        }
        updatedData.coverUrl = `/uploads/covers/${req.files['cover'][0].filename}`;
      }

      if (req.files['pdf']) {
        const oldPdfPath = path.join(pdfsDir, existingBook.pdfFilename);
        if (fs.existsSync(oldPdfPath)) {
          fs.unlinkSync(oldPdfPath);
        }
        updatedData.pdfFilename = req.files['pdf'][0].filename;
      }

      await dbHelper.set(`books/${bookId}`, updatedData);
      return res.json({ message: "Book updated successfully.", book: updatedData });
    } catch (error) {
      console.error("Edit Book Error:", error);
      return res.status(500).json({ message: "Failed to update book." });
    }
  });
});

// Admin Delete Book
app.delete('/api/books/:id', verifyAdminToken, async (req, res) => {
  const bookId = req.params.id;
  try {
    const book = await dbHelper.get(`books/${bookId}`);
    if (!book) {
      return res.status(404).json({ message: "Book not found." });
    }

    const coverFilename = book.coverUrl.split('/').pop();
    const coverPath = path.join(coversDir, coverFilename);
    if (fs.existsSync(coverPath)) {
      fs.unlinkSync(coverPath);
    }

    const pdfPath = path.join(pdfsDir, book.pdfFilename);
    if (fs.existsSync(pdfPath)) {
      fs.unlinkSync(pdfPath);
    }

    await dbHelper.remove(`books/${bookId}`);
    return res.json({ message: "Book deleted successfully." });
  } catch (error) {
    console.error("Delete Book Error:", error);
    return res.status(500).json({ message: "Failed to delete book." });
  }
});

// Secure download PDF endpoint
app.get('/api/books/:id/download', verifyUserOrAdminToken, async (req, res) => {
  const bookId = req.params.id;
  const isUserAdmin = req.userRole === 'admin';
  const userId = req.user ? req.user.userId : null;

  try {
    const book = await dbHelper.get(`books/${bookId}`);
    if (!book) {
      return res.status(404).json({ message: "Book not found." });
    }

    if (isUserAdmin) {
      const pdfPath = path.join(pdfsDir, book.pdfFilename);
      if (!fs.existsSync(pdfPath)) {
        return res.status(404).json({ message: "PDF file not found on server." });
      }
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${book.title.replace(/[^a-zA-Z0-9]/g, '_')}.pdf"`);
      return fs.createReadStream(pdfPath).pipe(res);
    }

    const purchases = await dbHelper.get('purchases');
    let hasPurchased = false;

    if (purchases) {
      hasPurchased = Object.values(purchases).some(p => p.userId === userId && p.bookId === bookId && p.paymentStatus === 'COMPLETED');
    }

    if (book.price === 0) {
      hasPurchased = true;
    }

    if (!hasPurchased) {
      return res.status(403).json({ message: "Access Denied. You must purchase this e-book before downloading." });
    }

    const pdfPath = path.join(pdfsDir, book.pdfFilename);
    if (!fs.existsSync(pdfPath)) {
      return res.status(404).json({ message: "PDF file not found on server." });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${book.title.replace(/[^a-zA-Z0-9]/g, '_')}.pdf"`);
    return fs.createReadStream(pdfPath).pipe(res);

  } catch (error) {
    console.error("Secure Download Error:", error);
    return res.status(500).json({ message: "Error downloading e-book." });
  }
});


// 3. Category Routes
app.get('/api/categories', async (req, res) => {
  try {
    const categories = await dbHelper.get('categories');
    if (!categories) return res.json([]);
    return res.json(Object.keys(categories));
  } catch (error) {
    console.error("Get Categories Error:", error);
    return res.status(500).json({ message: "Error loading categories." });
  }
});

app.post('/api/categories', verifyAdminToken, async (req, res) => {
  const { name } = req.body;
  if (!name || name.trim() === '') {
    return res.status(400).json({ message: "Category name is required." });
  }

  try {
    const cleanName = name.trim();
    await dbHelper.set(`categories/${cleanName}`, true);
    return res.status(201).json({ message: "Category added successfully.", category: cleanName });
  } catch (error) {
    console.error("Add Category Error:", error);
    return res.status(500).json({ message: "Failed to add category." });
  }
});


// 4. PayPal Payment Verification Routes
app.get('/api/payments/config', verifyUserToken, (req, res) => {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  if (!clientId || clientId === 'placeholder_paypal_client_id') {
    return res.json({ clientId: 'sb' });
  }
  return res.json({ clientId });
});

app.post('/api/payments/create-order', verifyUserToken, async (req, res) => {
  const { bookId } = req.body;
  if (!bookId) {
    return res.status(400).json({ message: "Book ID is required to create a payment order." });
  }

  try {
    const book = await dbHelper.get(`books/${bookId}`);
    if (!book) {
      return res.status(404).json({ message: "Book not found." });
    }

    const price = parseFloat(book.price);
    if (price <= 0) {
      return res.status(400).json({ message: "This e-book is free; checkout is not required." });
    }

    const accessToken = await getPayPalAccessToken();
    const apiUrl = process.env.PAYPAL_API_URL || 'https://api-m.sandbox.paypal.com';

    const orderPayload = {
      intent: 'CAPTURE',
      purchase_units: [{
        amount: {
          currency_code: 'USD',
          value: price.toFixed(2)
        },
        description: `E-Book Purchase: ${book.title}`
      }],
      application_context: {
        shipping_preference: 'NO_SHIPPING',
        user_action: 'PAY_NOW',
        landing_page: 'LOGIN'
      }
    };

    const paypalResponse = await fetch(`${apiUrl}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(orderPayload)
    });

    if (!paypalResponse.ok) {
      const errText = await paypalResponse.text();
      return res.status(paypalResponse.status).json({ message: `PayPal Order Creation failed: ${errText}` });
    }

    const order = await paypalResponse.json();
    return res.status(201).json({ orderID: order.id });
  } catch (error) {
    console.error("PayPal Create Order Error:", error);
    return res.status(500).json({ message: error.message || "Failed to initiate PayPal order." });
  }
});

app.post('/api/payments/capture-order', verifyUserToken, async (req, res) => {
  const { orderID, bookId } = req.body;
  if (!orderID || !bookId) {
    return res.status(400).json({ message: "Order ID and Book ID are required." });
  }

  try {
    const book = await dbHelper.get(`books/${bookId}`);
    if (!book) {
      return res.status(404).json({ message: "Book not found." });
    }

    const accessToken = await getPayPalAccessToken();
    const apiUrl = process.env.PAYPAL_API_URL || 'https://api-m.sandbox.paypal.com';

    const paypalResponse = await fetch(`${apiUrl}/v2/checkout/orders/${orderID}/capture`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!paypalResponse.ok) {
      const errText = await paypalResponse.text();
      return res.status(paypalResponse.status).json({ message: `PayPal Capture failed: ${errText}` });
    }

    const captureData = await paypalResponse.json();

    if (captureData.status !== 'COMPLETED') {
      return res.status(400).json({ message: "PayPal transaction was not completed.", status: captureData.status });
    }

    const purchaseId = 'pur_' + Math.random().toString(36).substr(2, 9);
    const purchase = {
      purchaseId,
      userId: req.user.userId,
      bookId: book.bookId,
      amountPaid: book.price,
      paymentStatus: 'COMPLETED',
      purchaseDate: new Date().toISOString()
    };
    await dbHelper.set(`purchases/${purchaseId}`, purchase);

    const payment = {
      paymentId: orderID,
      purchaseId,
      userId: req.user.userId,
      bookId: book.bookId,
      amount: book.price,
      status: 'COMPLETED',
      paypalPayerId: captureData.payer.payer_id,
      timestamp: new Date().toISOString()
    };
    await dbHelper.set(`payments/${orderID}`, payment);

    return res.status(200).json({ message: "Payment verified and order completed successfully.", purchaseId });
  } catch (error) {
    console.error("PayPal Capture Order Error:", error);
    return res.status(500).json({ message: error.message || "Failed to capture PayPal payment." });
  }
});


// 5. Admin Dashboard APIs
app.get('/api/admin/users', verifyAdminToken, async (req, res) => {
  try {
    const users = await dbHelper.get('users') || {};
    const safeUsers = Object.values(users).map(u => {
      const { passwordHash: _, ...safeUser } = u;
      return safeUser;
    });
    return res.json(safeUsers);
  } catch (error) {
    console.error("Admin Get Users Error:", error);
    return res.status(500).json({ message: "Failed to load users list." });
  }
});

app.get('/api/admin/purchases', verifyAdminToken, async (req, res) => {
  try {
    const purchases = await dbHelper.get('purchases') || {};
    const users = await dbHelper.get('users') || {};
    const books = await dbHelper.get('books') || {};

    const purchasesDetailList = Object.values(purchases).map(p => {
      const user = users[p.userId] || { name: 'Unknown User', email: 'N/A' };
      const book = books[p.bookId] || { title: 'Unknown Book', category: 'N/A' };

      return {
        ...p,
        userName: user.name,
        userEmail: user.email,
        bookTitle: book.title,
        bookCategory: book.category
      };
    });

    return res.json(purchasesDetailList);
  } catch (error) {
    console.error("Admin Get Purchases Error:", error);
    return res.status(500).json({ message: "Failed to load purchases history." });
  }
});

app.get('/api/admin/sales-summary', verifyAdminToken, async (req, res) => {
  try {
    const purchases = await dbHelper.get('purchases') || {};
    const books = await dbHelper.get('books') || {};
    const users = await dbHelper.get('users') || {};

    const totalRevenue = Object.values(purchases)
      .filter(p => p.paymentStatus === 'COMPLETED')
      .reduce((sum, p) => sum + parseFloat(p.amountPaid || 0), 0);

    const salesCount = Object.values(purchases).filter(p => p.paymentStatus === 'COMPLETED').length;
    const usersCount = Object.keys(users).length;
    const booksCount = Object.keys(books).length;

    const salesByCategory = {};
    Object.values(purchases).forEach(p => {
      if (p.paymentStatus === 'COMPLETED') {
        const book = books[p.bookId];
        const category = book ? book.category : 'Unknown';
        salesByCategory[category] = (salesByCategory[category] || 0) + parseFloat(p.amountPaid || 0);
      }
    });

    const recentSales = Object.values(purchases)
      .sort((a, b) => new Date(b.purchaseDate) - new Date(a.purchaseDate))
      .slice(0, 5)
      .map(p => {
        const user = users[p.userId] || { name: 'Unknown User' };
        const book = books[p.bookId] || { title: 'Unknown Book' };
        return {
          purchaseId: p.purchaseId,
          userName: user.name,
          bookTitle: book.title,
          amountPaid: p.amountPaid,
          purchaseDate: p.purchaseDate
        };
      });

    return res.json({
      totalRevenue,
      salesCount,
      usersCount,
      booksCount,
      salesByCategory,
      recentSales
    });
  } catch (error) {
    console.error("Admin Sales Summary Error:", error);
    return res.status(500).json({ message: "Failed to compute sales analytics." });
  }
});

// User check purchased books list (used in user dashboard)
app.get('/api/users/me/purchases', verifyUserToken, async (req, res) => {
  const userId = req.user.userId;
  try {
    const purchases = await dbHelper.get('purchases') || {};
    const books = await dbHelper.get('books') || {};

    const userPurchasedBookIds = Object.values(purchases)
      .filter(p => p.userId === userId && p.paymentStatus === 'COMPLETED')
      .map(p => p.bookId);

    const purchasedBooks = Object.values(books)
      .filter(book => userPurchasedBookIds.includes(book.bookId) || book.price === 0)
      .map(book => {
        const { pdfPath: _, ...bookPublic } = book;
        return bookPublic;
      });

    return res.json(purchasedBooks);
  } catch (error) {
    console.error("User Purchases Fetch Error:", error);
    return res.status(500).json({ message: "Failed to load purchased books." });
  }
});

// Start listening
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
