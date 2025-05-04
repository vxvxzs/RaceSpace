import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import Papa from 'papaparse';
import dotenv from 'dotenv';
import crypto from 'crypto';
import fetch from 'node-fetch';

dotenv.config();

const app = express();
const port = process.env.PORT || 5050;
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');

// File upload configuration
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.join(__dirname, 'uploads');

// Ensure upload directory exists
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Add these routes before the error handling middleware in server.mjs

// Root route for testing
app.get('/', (req, res) => {
  res.json({
    message: 'RaceSpace API is running',
    endpoints: {
      root: 'GET /',
      register: 'POST /register',
      login: 'POST /login',
      analyze: 'POST /analyze'
    },
    status: 'online',
    timestamp: new Date().toISOString()
  });
});

// Test route to check if server is alive
app.get('/ping', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Route to list available endpoints
app.get('/endpoints', (req, res) => {
  res.json({
    available_endpoints: {
      auth: {
        register: {
          method: 'POST',
          url: '/register',
          requires: ['email', 'password', 'name'],
          optional: ['avatar']
        },
        login: {
          method: 'POST',
          url: '/login',
          requires: ['email', 'password']
        }
      },
      analysis: {
        analyze: {
          method: 'POST',
          url: '/analyze',
          requires: ['telemetry', 'track', 'carClass', 'game'],
          auth: 'required'
        }
      }
    }
  });
});

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadDir),
  filename: (_, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
    cb(null, `${uniqueSuffix}-${file.originalname}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (_, file, cb) => {
    const allowedTypes = ['.csv', '.json', '.motec', '.rdp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  }
});

// Middleware
// Update the CORS configuration near the top of your server.mjs
app.use(cors({
  origin: ['http://localhost:5050'],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// Add headers middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// In-memory database (replace with real database in production)
const users = new Map();
const sessions = new Map();

// Auth middleware
const auth = (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = users.get(decoded.id);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Rate limiting for analysis
const analysisRateLimit = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_REQUESTS = 5;

const rateLimiter = (ip) => {
  const now = Date.now();
  const userRequests = analysisRateLimit.get(ip) || [];
  const recentRequests = userRequests.filter(time => now - time < RATE_LIMIT_WINDOW);
  
  if (recentRequests.length >= MAX_REQUESTS) {
    return false;
  }
  
  recentRequests.push(now);
  analysisRateLimit.set(ip, recentRequests);
  return true;
};

// Helper Functions
function extractTrackPointsFromTelemetry(telemetryData, format) {
  try {
    let trackPoints = [];
    let dataPoints = [];
    
    if (format === 'csv') {
      const parsedData = Papa.parse(telemetryData, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true
      });
      
      if (parsedData.data && parsedData.data.length > 0) {
        const headers = Object.keys(parsedData.data[0]);
        const xPos = headers.find(h => 
          h.toLowerCase().includes('position_x') || 
          h.toLowerCase().includes('x_pos') || 
          h === 'x' || 
          h.toLowerCase().includes('worldpositionx')
        );
        const yPos = headers.find(h => 
          h.toLowerCase().includes('position_z') || 
          h.toLowerCase().includes('z_pos') || 
          h === 'z' || 
          h.toLowerCase().includes('worldpositionz')
        );

        if (xPos && yPos) {
          const sampleRate = Math.max(1, Math.floor(parsedData.data.length / 200));
          trackPoints = parsedData.data
            .filter((_, i) => i % sampleRate === 0)
            .map(row => [row[xPos], row[yPos]])
            .filter(point => point[0] != null && point[1] != null);
          dataPoints = parsedData.data;
        }
      }
    } else if (format === 'json') {
      const data = JSON.parse(telemetryData);
      if (Array.isArray(data)) {
        trackPoints = data
          .filter(point => point.x != null && point.z != null)
          .map(point => [point.x, point.z]);
        dataPoints = data;
      } else if (data.telemetry && Array.isArray(data.telemetry)) {
        trackPoints = data.telemetry
          .filter(point => point.position?.x != null && point.position?.z != null)
          .map(point => [point.position.x, point.position.z]);
        dataPoints = data.telemetry;
      }
    }
    
    trackPoints = smoothTrackPoints(trackPoints);
    return { valid: true, trackPoints, dataPoints };
  } catch (error) {
    console.error('Error extracting track points:', error);
    return { valid: false, reason: `Error extracting track data: ${error.message}` };
  }
}

function smoothTrackPoints(points, windowSize = 5) {
  if (points.length < windowSize) return points;
  
  return points.map((_, i) => {
    const window = points.slice(
      Math.max(0, i - windowSize),
      Math.min(points.length, i + windowSize + 1)
    );
    return [
      window.reduce((sum, p) => sum + p[0], 0) / window.length,
      window.reduce((sum, p) => sum + p[1], 0) / window.length
    ];
  });
}

function findProblemAreas(dataPoints, format) {
  const problems = [];
  
  try {
    if (!dataPoints || dataPoints.length === 0) return problems;

    const headers = Object.keys(dataPoints[0]);
    const getColumn = (keywords) =>
      headers.find(h => keywords.some(k => h.toLowerCase().includes(k)));

    const columns = {
      speed: getColumn(['speed', 'velocity', 'kmh', 'mph']),
      throttle: getColumn(['throttle', 'gas']),
      brake: getColumn(['brake']),
      gear: getColumn(['gear']),
      posX: getColumn(['position_x', 'x_pos', 'x', 'worldpositionx']),
      posY: getColumn(['position_z', 'z_pos', 'z', 'worldpositionz'])
    };

    const getNorm = (value, allVals) => {
      const min = Math.min(...allVals);
      const max = Math.max(...allVals);
      return max > min ? ((value - min) / (max - min)) * 100 : 50;
    };

    const allX = dataPoints.map(p => p[columns.posX] || 0);
    const allY = dataPoints.map(p => p[columns.posY] || 0);

    for (let i = 1; i < dataPoints.length - 1; i++) {
      const prev = dataPoints[i - 1];
      const curr = dataPoints[i];
      const next = dataPoints[i + 1];

      if (i % 10 !== 0) continue;

      const speedDrop = prev[columns.speed] - curr[columns.speed];
      const brake = curr[columns.brake];
      const throttle = curr[columns.throttle];
      const gear = curr[columns.gear];

      const position = [
        getNorm(curr[columns.posX], allX),
        getNorm(curr[columns.posY], allY)
      ];

      if (brake > 0.8 && speedDrop > 20) {
        problems.push({
          position,
          description: 'Harsh braking detected',
          severity: 'high',
          timeLost: `${(speedDrop * 0.05).toFixed(2)}s`
        });
      }

      if (brake > 0.2 && throttle > 0.5) {
        problems.push({
          position,
          description: 'Overlapping throttle and brake',
          severity: 'medium',
          timeLost: '0.2s'
        });
      }

      if (columns.gear && curr[columns.speed] > 200 && gear < 5) {
        problems.push({
          position,
          description: 'Late upshift detected',
          severity: 'low',
          timeLost: '0.1s'
        });
      }
    }

    return problems;
  } catch (error) {
    console.error('Error finding problem areas:', error);
    return [];
  }
}

async function analyzeTelemetryWithAI(telemetryData, track, carClass, game) {
  const fileExtension = telemetryData.substring(0, 20).includes('{') ? 'json' : 'csv';
  const extractionResult = extractTrackPointsFromTelemetry(telemetryData, fileExtension);
  
  if (!extractionResult.valid) {
    return extractionResult;
  }
  
  const { trackPoints, dataPoints } = extractionResult;
  const problems = findProblemAreas(dataPoints, fileExtension);

  try {
    // Prepare data for AI analysis
    const aiPrompt = `Analyze this racing telemetry data for ${track} using ${carClass} in ${game}:
    Track Points: ${JSON.stringify(trackPoints.slice(0, 5))}... (${trackPoints.length} points total)
    Problems Detected: ${JSON.stringify(problems)}
    
    Provide detailed racing analysis including:
    1. Lap time analysis and potential improvements
    2. Speed analysis for key corners
    3. Braking points optimization
    4. Racing line recommendations
    5. Specific areas for improvement
    
    Format the response as a JSON object with the following structure:
    {
      "lapAnalysis": { "currentTime": string, "potentialImprovement": string },
      "cornerAnalysis": { "turnNumber": { "entry": string, "exit": string } },
      "brakingPoints": { "turnNumber": string },
      "recommendations": string[],
      "sectors": [{ "number": number, "time": string, "mistakes": [] }]
    }`;

    // Call DeepSeek API
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.DEEPSEEKAPI}`
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          {
            "role": "system",
            "content": "You are a professional racing analyst specializing in telemetry data analysis."
          },
          {
            "role": "user",
            "content": aiPrompt
          }
        ],
        temperature: 0.7
      })
    });

    if (!response.ok) {
      throw new Error(`DeepSeek API error: ${response.statusText}`);
    }

    const aiResponse = await response.json();
    const analysis = JSON.parse(aiResponse.choices[0].message.content);

    // Format the final result using AI analysis
    const result = {
      id: Date.now(),
      date: new Date().toISOString(),
      track,
      carClass,
      game,
      status: 'completed',
      telemetry: {
        speedAnalysis: analysis.cornerAnalysis,
        brakingPoints: analysis.brakingPoints
      },
      stats: {
        lapTime: analysis.lapAnalysis.currentTime,
        topSpeed: `${Math.max(...dataPoints.map(p => p.speed || 0))} km/h`,
        avgSpeed: `${(dataPoints.reduce((sum, p) => sum + (p.speed || 0), 0) / dataPoints.length).toFixed(1)} km/h`,
        throttleUsage: `${(dataPoints.reduce((sum, p) => sum + (p.throttle || 0), 0) / dataPoints.length * 100).toFixed(1)}%`,
        brakingPoints: Object.keys(analysis.brakingPoints).length,
        improvement: analysis.lapAnalysis.potentialImprovement
      },
      trackPoints,
      errors: problems,
      sectors: analysis.sectors,
      recommendations: analysis.recommendations
    };
    
    return { valid: true, data: result };
  } catch (error) {
    console.error('AI Analysis Error:', error);
    return { valid: false, reason: `AI analysis failed: ${error.message}` };
  }
}
// Routes
app.post('/register', async (req, res) => {
  try {
    const { email, password, name, avatar } = req.body;

    if ([...users.values()].some(u => u.email === email)) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = {
      id: crypto.randomUUID(),
      email,
      name,
      password: hashedPassword,
      avatar: avatar || `https://avatars.dicebear.com/api/initials/${encodeURIComponent(name)}.svg`,
      createdAt: new Date().toISOString(),
      stats: {
        sessions: 0,
        tracks: 0,
        cars: 0,
        totalTime: '0h 0m',
        improvement: '+0.0s'
      },
      history: []
    };

    users.set(user.id, user);
    const token = jwt.sign({ id: user.id }, JWT_SECRET);
    const { password: _, ...userWithoutPassword } = user;
    
    res.status(201).json({ user: userWithoutPassword, token });
  } catch (error) {
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = [...users.values()].find(u => u.email === email);

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ id: user.id }, JWT_SECRET);
    const { password: _, ...userWithoutPassword } = user;
    
    res.json({ user: userWithoutPassword, token });
  } catch (error) {
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/analyze', auth, upload.single('telemetry'), async (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  
  if (!rateLimiter(ip)) {
    return res.status(429).json({ 
      error: 'Too many analysis requests. Please wait before trying again.' 
    });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'No telemetry file uploaded' });
  }

  const { track, carClass, game } = req.body;
  if (!track || !carClass || !game) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const filePath = req.file.path;
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const result = await analyzeTelemetryWithAI(fileContent, track, carClass, game);
    
    // Clean up the uploaded file
    fs.unlinkSync(filePath);
    
    if (!result.valid) {
      return res.status(400).json({ error: result.reason });
    }

    // Update user stats
    if (req.user) {
      req.user.stats.sessions += 1;
      if (!req.user.history.some(h => h.track === track)) {
        req.user.stats.tracks += 1;
      }
      if (!req.user.history.some(h => h.carClass === carClass)) {
        req.user.stats.cars += 1;
      }
      
      const totalTime = parseInt(req.user.stats.totalTime) || 0;
      req.user.stats.totalTime = `${totalTime + 1}h ${Math.floor(Math.random() * 60)}m`;
      
      req.user.history.unshift(result.data);
      users.set(req.user.id, req.user);
    }

    res.json(result.data);
  } catch (error) {
    console.error('Analysis failed:', error);
    res.status(500).json({ error: 'Analysis failed: ' + error.message });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

export default app;
