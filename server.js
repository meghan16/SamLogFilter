const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { main } = require('./index');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(express.json());

// Serve frontend.html as the default page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend.html'));
});
app.use(express.static(path.join(__dirname)));

// Endpoint to handle file upload and keywords
app.post('/api/process', upload.single('logFile'), async (req, res) => {
  try {
    const keywords = req.body.keywords || '';
    const filePath = req.file.path;
    const logContent = fs.readFileSync(filePath, 'utf8');
    // Call main with logContent and keywords
    const result = await main(logContent, keywords);
    fs.unlinkSync(filePath); // Clean up uploaded file
    res.json({ output: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
