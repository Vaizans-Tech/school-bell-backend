require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./swagger');

const app = express();

// Ensure uploads dir exists
const uploadsDir = path.join(__dirname, '..', process.env.UPLOAD_DIR || 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(uploadsDir));

// Swagger UI
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Routes
app.use('/api/auth',          require('./routes/auth'));
app.use('/api/device',        require('./routes/device'));
app.use('/api/schedules',     require('./routes/schedules'));
app.use('/api/sounds',        require('./routes/sounds'));
app.use('/api/announcements', require('./routes/announcements'));
app.use('/api/admin',         require('./routes/admin'));
app.use('/api/azan',          require('./routes/azan'));

app.get('/', (req, res) => res.json({ status: 'School Bell Server Running', version: '1.0.0', docs: 'http://localhost:8080/api-docs' }));

const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Network access: http://172.16.13.7:${PORT}`);
});
