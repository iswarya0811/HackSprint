// server.js
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 6 * 1024 * 1024 } // 6 MB
});

const app = express();
app.use(cors());
app.use(express.json()); // for JSON bodies if needed

// --- SQLite setup ---
const DB_PATH = path.join(__dirname, 'db.sqlite');
const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS complaints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      complaint_id TEXT UNIQUE NOT NULL,
      name TEXT,
      email TEXT,
      phone TEXT,
      title TEXT,
      details TEXT,
      category TEXT,
      location TEXT,
      priority TEXT,
      attachment TEXT,
      status TEXT DEFAULT 'Registered',
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS complaint_timeline (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      complaint_id TEXT NOT NULL,
      status TEXT NOT NULL,
      note TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
});

// Helper - generate readable unique complaint id
function generateComplaintId() {
  const now = new Date();
  const year = now.getFullYear();
  const rnd = Math.floor(1000 + Math.random() * 9000);
  const stamp = Date.now().toString().slice(-6);
  return `CCH-${year}-${stamp}${rnd}`;
}

// POST /api/complaints/create
app.post('/api/complaints/create', upload.single('attachment'), (req, res) => {
  try {
    const body = req.body;
    const name = body['citizen-name'] || body.name || null;
    const email = body['citizen-email'] || body.email || null;
    const phone = body['citizen-phone'] || body.phone || null;
    const title = body['complaint-title'] || body.title || null;
    const details = body['complaint-details'] || body.details || null;
    const category = body['category'] || null;
    const location = body['location'] || null;
    const priority = body['priority'] || 'Normal';

    if (!name || !title || !details) {
      return res.status(400).json({ success: false, message: 'Missing required fields: citizen-name, complaint-title, complaint-details' });
    }

    const complaintId = generateComplaintId();
    const attachmentPath = req.file ? req.file.filename : null;

    const insert = `
      INSERT INTO complaints (complaint_id, name, email, phone, title, details, category, location, priority, attachment)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.run(insert, [complaintId, name, email, phone, title, details, category, location, priority, attachmentPath], function (err) {
      if (err) {
        console.error('DB insert error:', err);
        return res.status(500).json({ success: false, message: 'Database error' });
      }

      // add initial timeline row
      db.run(`INSERT INTO complaint_timeline (complaint_id, status, note) VALUES (?, ?, ?)`, [complaintId, 'Complaint Registered', 'Created by user'], (tErr) => {
        if (tErr) console.error('timeline insert error', tErr);
        // return created id
        return res.status(201).json({ success: true, complaintId });
      });
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /api/complaints/:id
app.get('/api/complaints/:id', (req, res) => {
  const id = req.params.id;
  db.get(`SELECT * FROM complaints WHERE complaint_id = ?`, [id], (err, row) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: 'Database error' });
    }
    if (!row) return res.status(404).json({ success: false, message: 'Not found' });

    db.all(`SELECT status, note, created_at FROM complaint_timeline WHERE complaint_id = ? ORDER BY created_at ASC`, [id], (tErr, timelineRows) => {
      if (tErr) {
        console.error(tErr);
        return res.status(500).json({ success: false, message: 'Timeline error' });
      }

      // Build timeline JSON
      const timeline = timelineRows.map(r => ({ status: r.status, note: r.note, date: r.created_at }));
      return res.json({
        success: true,
        complaintId: id,
        complaint: {
          name: row.name,
          email: row.email,
          phone: row.phone,
          title: row.title,
          details: row.details,
          category: row.category,
          location: row.location,
          priority: row.priority,
          status: row.status,
          attachment: row.attachment ? `/uploads/${row.attachment}` : null,
          created_at: row.created_at
        },
        timeline
      });
    });
  });
});

// Serve uploaded files (for demo only). In prod serve via CDN or secure method.
app.use('/uploads', express.static(UPLOAD_DIR));

// Simple endpoint to add timeline update (for admin testing)
app.post('/api/complaints/:id/timeline', express.json(), (req, res) => {
  const id = req.params.id;
  const status = req.body.status || 'Updated';
  const note = req.body.note || null;
  db.run(`INSERT INTO complaint_timeline (complaint_id, status, note) VALUES (?, ?, ?)`, [id, status, note], function (err) {
    if (err) return res.status(500).json({ success: false, message: 'DB error' });
    // Optionally update current status in complaints table
    db.run(`UPDATE complaints SET status = ? WHERE complaint_id = ?`, [status, id], (uErr) => {
      if (uErr) console.error('status update err', uErr);
      return res.json({ success: true, message: 'Timeline updated' });
    });
  });
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
