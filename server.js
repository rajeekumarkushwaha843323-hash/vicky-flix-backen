
const express = require('express');
const multer = require('multer');
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;
const MAX_VIDEOS = 10;

app.use(express.json());

if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  throw new Error('Firebase service account missing');
}

admin.initializeApp({
  credential: admin.credential.cert(
    JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
  )
});

const db = admin.firestore();
const movies = db.collection('movies');

const uploadDir = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, file.mimetype === 'video/mp4');
  }
});

async function adminOnly(req, res, next) {
  try {
    const token = (req.headers.authorization || '')
      .replace(/^Bearer /, '');

    if (!token) {
      return res.status(401).json({ error: 'Login required' });
    }

    const user = await admin.auth().verifyIdToken(token);
    const allowed = (process.env.ADMIN_EMAILS || '')
      .split(',')
      .map(x => x.trim().toLowerCase());

    if (!allowed.includes((user.email || '').toLowerCase())) {
      return res.status(403).json({ error: 'Admin access denied' });
    }

    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

app.get('/', (req, res) => {
  res.send('VICKY FLIX Backend is running!');
});

app.get('/api/videos', async (req, res) => {
  try {
    const snapshot = await movies.orderBy('createdAt', 'desc').get();
    res.json(snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })));
  } catch {
    res.status(500).json({ error: 'Could not load videos' });
  }
});

app.post('/api/admin/upload', adminOnly, upload.single('video'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'MP4 video required' });
  }

  try {
    const count = await movies.count().get();

    if (count.data().count >= MAX_VIDEOS) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Maximum 10 videos allowed' });
    }

    const doc = await movies.add({
      title: req.body.title || path.parse(req.file.originalname).name,
      category: req.body.category || 'Movies',
      localFile: req.file.filename,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.status(201).json({ message: 'Video added', id: doc.id });
  } catch (error) {
    fs.unlinkSync(req.file.path);
    res.status(500).json({ error: 'Upload failed' });
  }
});

app.delete('/api/admin/movies/:id', adminOnly, async (req, res) => {
  try {
    const ref = movies.doc(req.params.id);
    const doc = await ref.get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Movie not found' });
    }

    const file = path.join(uploadDir, doc.data().localFile || '');

    if (fs.existsSync(file)) fs.unlinkSync(file);
    await ref.delete();

    res.json({ message: 'Movie deleted' });
  } catch {
    res.status(500).json({ error: 'Delete failed' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`VICKY FLIX running on ${PORT}`);
});
                                                       
