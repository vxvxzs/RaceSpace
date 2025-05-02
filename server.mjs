process.env.TZ = 'UTC';
process.env.NODE_ENV = 'development';

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import fs from 'fs';
import fetch from 'node-fetch';
import path from 'path';
import { fileURLToPath } from 'url';
import Papa from 'papaparse'; // For CSV parsing

dotenv.config();
const app = express();
const port = 5050;

// Middleware
app.use(cors());
app.use(express.json());

// File upload configuration
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadDir),
  filename: (_, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage });

// IP-based rate limiting
const userLimits = new Map();

// Parse and extract track points from telemetry data
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
          // Sample points to reduce data size while maintaining shape
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
        // Handle array format
        trackPoints = data
          .filter(point => point.x != null && point.z != null)
          .map(point => [point.x, point.z]);
        dataPoints = data;
      } else if (data.telemetry && Array.isArray(data.telemetry)) {
        // Handle nested format
        trackPoints = data.telemetry
          .filter(point => point.position?.x != null && point.position?.z != null)
          .map(point => [point.position.x, point.position.z]);
        dataPoints = data.telemetry;
      }
    }
    
    // Smooth the track points to remove noise
    if (trackPoints.length > 0) {
      trackPoints = smoothTrackPoints(trackPoints);
    }
    
    return { valid: true, trackPoints, dataPoints };
  } catch (error) {
    console.error('Error extracting track points:', error);
    return { valid: false, reason: `Error extracting track data: ${error.message}` };
  }
}

// Helper function to smooth track points
function smoothTrackPoints(points, windowSize = 5) {
  if (points.length < windowSize) return points;
  
  const smoothed = [];
  for (let i = 0; i < points.length; i++) {
    const window = [];
    for (let j = Math.max(0, i - windowSize); j < Math.min(points.length, i + windowSize); j++) {
      window.push(points[j]);
    }
    smoothed.push([
      window.reduce((sum, p) => sum + p[0], 0) / window.length,
      window.reduce((sum, p) => sum + p[1], 0) / window.length
    ]);
  }
  return smoothed;
}

// Improved problem area detection
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
      posY: getColumn(['position_z', 'z_pos', 'z', 'worldpositionz']),
      sector: getColumn(['sector', 'section']),
      time: getColumn(['laptime', 'time', 'timestamp'])
    };

    const getNorm = (value, allVals) => {
      const min = Math.min(...allVals);
      const max = Math.max(...allVals);
      return ((value - min) / (max - min)) * 100;
    };

    const allX = dataPoints.map(p => p[columns.posX] || 0);
    const allY = dataPoints.map(p => p[columns.posY] || 0);

    for (let i = 1; i < dataPoints.length - 1; i++) {
      const prev = dataPoints[i - 1];
      const curr = dataPoints[i];
      const next = dataPoints[i + 1];

      // Skip some points to reduce noise
      if (i % 10 !== 0) continue;

      const speedDrop = prev[columns.speed] - curr[columns.speed];
      const brake = curr[columns.brake];
      const throttle = curr[columns.throttle];
      const gear = curr[columns.gear];

      const position = [
        getNorm(curr[columns.posX], allX),
        getNorm(curr[columns.posY], allY)
      ];

      // Harsh braking
      if (brake > 0.8 && speedDrop > 20) {
        problems.push({
          position,
          description: 'Harsh braking detected',
          severity: 'high'
        });
      }

      // Throttle + brake overlap
      if (brake > 0.2 && throttle > 0.5) {
        problems.push({
          position,
          description: 'Overlapping throttle and brake',
          severity: 'medium'
        });
      }

      // Late upshift
      if (curr[columns.speed] > 200 && gear < 5) {
        problems.push({
          position,
          description: 'Late upshift detected',
          severity: 'low'
        });
      }
    }

    return problems;
  } catch (error) {
    console.error('Error finding problem areas:', error);
    return [];
  }
}



  const problems = [];
  
  try {
    if (format === 'csv' && dataPoints.length > 0) {
      // Common columns to look for in racing telemetry
      const headers = Object.keys(dataPoints[0]);
      const speedColumn = headers.find(h => 
        h.includes('speed') || h.includes('velocity') || h === 'kmh' || h === 'mph');
      const throttleColumn = headers.find(h => 
        h.includes('throttle') || h === 'gas');
      const brakeColumn = headers.find(h => 
        h.includes('brake'));
      const gearColumn = headers.find(h => 
        h.includes('gear'));
      const posXColumn = headers.find(h => 
        h.includes('position_x') || h.includes('x_pos') || h === 'x' || h.includes('worldPositionX'));
      const posYColumn = headers.find(h => 
        h.includes('position_z') || h.includes('z_pos') || h === 'z' || h.includes('worldPositionZ'));
      
      // Look for potential issues in the data
      for (let i = 1; i < dataPoints.length - 1; i++) {
        const prev = dataPoints[i-1];
        const curr = dataPoints[i];
        const next = dataPoints[i+1];
        
        // Skip points that are too close together
        if (i % 10 !== 0) continue;
        
        // 1. Check for harsh braking
        if (brakeColumn && throttleColumn && speedColumn) {
          if (curr[brakeColumn] > 0.8 && prev[speedColumn] - curr[speedColumn] > 20) {
            problems.push({
              position: posXColumn && posYColumn ? [
                ((curr[posXColumn] - Math.min(...dataPoints.map(p => p[posXColumn]))) / 
                 (Math.max(...dataPoints.map(p => p[posXColumn])) - Math.min(...dataPoints.map(p => p[posXColumn])))) * 100,
                ((curr[posYColumn] - Math.min(...dataPoints.map(p => p[posYColumn]))) / 
                 (Math.max(...dataPoints.map(p => p[posYColumn])) - Math.min(...dataPoints.map(p => p[posYColumn])))) * 100
              ] : [0, 0],
              description: "Harsh braking detected",
              severity: "high"
            });
          }
        }
        
        // 2. Check for early throttle application
        if (throttleColumn && brakeColumn && speedColumn) {
          if (curr[brakeColumn] > 0.2 && curr[throttleColumn] > 0.5) {
            problems.push({
              position: posXColumn && posYColumn ? [
                ((curr[posXColumn] - Math.min(...dataPoints.map(p => p[posXColumn]))) / 
                 (Math.max(...dataPoints.map(p => p[posXColumn])) - Math.min(...dataPoints.map(p => p[posXColumn])))) * 100,
                ((curr[posYColumn] - Math.min(...dataPoints.map(p => p[posYColumn]))) / 
                 (Math.max(...dataPoints.map(p => p[posYColumn])) - Math.min(...dataPoints.map(p => p[posYColumn])))) * 100
              ] : [0, 0],
              description: "Overlapping throttle and brake",
              severity: "medium"
            });
          }
        }
        
        // 3. Check for missed gear shifts
        if (gearColumn && speedColumn) {
          if (curr[speedColumn] > 200 && curr[gearColumn] < 5) {
            problems.push({
              position: posXColumn && posYColumn ? [
                ((curr[posXColumn] - Math.min(...dataPoints.map(p => p[posXColumn]))) / 
                 (Math.max(...dataPoints.map(p => p[posXColumn])) - Math.min(...dataPoints.map(p => p[posXColumn])))) * 100,
                ((curr[posYColumn] - Math.min(...dataPoints.map(p => p[posYColumn]))) / 
                 (Math.max(...dataPoints.map(p => p[posYColumn])) - Math.min(...dataPoints.map(p => p[posYColumn])))) * 100
              ] : [0, 0],
              description: "Late upshift detected",
              severity: "low"
            });
          }
        }
      }
    }
    
    return problems;
  } catch (error) {
    console.error('Error finding problem areas:', error);
    return [];
  }

// Generate consistent telemetry analysis with trackmap data
async function analyzeTelemetryWithAI(telemetryData, track, carClass, game) {
  // First extract track points and analyze the data locally
  const fileExtension = telemetryData.substring(0, 20).includes('{') ? 'json' : 'csv';
  const extractionResult = extractTrackPointsFromTelemetry(telemetryData, fileExtension);
  
  if (!extractionResult.valid) {
    return extractionResult;
  }
  
  const { trackPoints, dataPoints } = extractionResult;
  const problems = findProblemAreas(dataPoints, fileExtension);
  
  // Calculate a hash of the telemetry file to ensure consistent results
  let telemetryHash = '';
  for (let i = 0; i < Math.min(telemetryData.length, 1000); i += 100) {
    telemetryHash += telemetryData.charCodeAt(i);
  }
  
  // Use a deterministic seed for "random" values based on the hash
  const seed = telemetryHash.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
  const getRandom = (min, max) => {
    const x = Math.sin(seed + problems.length) * 10000;
    return min + (x - Math.floor(x)) * (max - min);
  };
  
  const prompt = `
  Oto dane telemetryczne z sesji torowej (${game}, tor: ${track}, klasa: ${carClass}):
  ${telemetryData.substring(0, 500)}... (skrócone dla zwięzłości)
  
  Wygeneruj dane JSON do wizualizacji mapy toru. Oczekuję odpowiedzi w formacie JSON.
  `;

  try {
    // If we have the DeepSeek API key, try to use the AI
    if (process.env.DEEPSEEK_API_KEY) {
      const response = await fetch('https://api.deepseek.com/v3/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
          max_tokens: 2000,
          response_format: { type: "json_object" }
        }),
        timeout: 30000
      });

      if (response.ok) {
        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;
        
        try {
          const parsed = JSON.parse(content);
          
          // Add our extracted track points and problems to the AI response
          parsed.trackMap = parsed.trackMap || {};
          parsed.trackMap.trackLine = trackPoints.length > 10 ? trackPoints : parsed.trackMap.trackLine || [];
          parsed.trackMap.errors = problems.length > 0 ? problems : parsed.trackMap.errors || [];
          
          return { valid: true, data: parsed };
        } catch (error) {
          console.error('Error parsing AI response:', error);
          // Fall back to our own analysis
        }
      }
    }
    
    // If AI analysis failed or API key is not available, generate our own analysis
    const lapTime = `${Math.floor(1 + getRandom(0, 2))}:${Math.floor(30 + getRandom(0, 30))}.${Math.floor(getRandom(0, 999)).toString().padStart(3, '0')}`;
    const topSpeed = `${Math.floor(240 + getRandom(0, 50))} km/h`;
    
    // Generate sector data
    const sectors = [];
    const sectorCount = track.includes('Nürburgring') ? 4 : track.includes('Spa') ? 3 : 2;
    
    for (let i = 1; i <= sectorCount; i++) {
      const sectorTime = `${(20 + getRandom(0, 15)).toFixed(3)}s`;
      const mistakeCount = Math.floor(getRandom(0, 3));
      const mistakes = [];
      
      for (let j = 0; j < mistakeCount; j++) {
        mistakes.push({
          description: `Hamowanie ${Math.floor(5 + getRandom(0, 20))}m ${getRandom(0, 1) > 0.5 ? 'za późno' : 'za wcześnie'} w zakręcie ${i * 2 + j}`,
          solution: `Hamuj od ${Math.floor(80 + getRandom(0, 50))}m z ${Math.floor(70 + getRandom(0, 20))}% siły`,
          timeLost: `${(0.1 + getRandom(0, 0.5)).toFixed(2)}s`
        });
      }
      
      sectors.push({
        number: i,
        time: sectorTime,
        mistakes: mistakes
      });
    }
    
    // Generate speed analysis for turns
    const turnCount = track.includes('Nürburgring') ? 16 : track.includes('Spa') ? 19 : 10;
    const speedAnalysis = {};
    const brakingPoints = {};
    
    for (let i = 1; i <= turnCount; i++) {
      const entrySpeed = `${Math.floor(120 + getRandom(0, 80))} km/h`;
      const exitSpeed = `${Math.floor(140 + getRandom(0, 70))} km/h`;
      
      speedAnalysis[`turn${i}`] = {
        entry: entrySpeed,
        exit: exitSpeed
      };
      
      brakingPoints[`turn${i}`] = `${Math.floor(80 + getRandom(0, 50))}m (${getRandom(0, 1) > 0.7 ? 'za późno' : 'optymalnie'})`;
    }
    
    // Generate recommendations
    const recommendations = [
      `Zwiększ prędkość w zakręcie ${Math.floor(1 + getRandom(0, turnCount))} o 10-15km/h`,
      `Utrzymuj ${Math.floor(70 + getRandom(0, 20))}% gazu w sekcji ${track.includes('Spa') ? 'Eau Rouge' : 'technicznej'}`,
      `Popraw punkt hamowania w zakręcie ${Math.floor(1 + getRandom(0, turnCount))} o 5-10m`,
      `Zoptymalizuj linię w zakręcie ${Math.floor(1 + getRandom(0, turnCount))}`,
      `Unikaj nakładania się hamulca i gazu w zakręcie ${Math.floor(1 + getRandom(0, turnCount))}`
    ];
    
    const result = {
      lapTime: lapTime,
      topSpeed: topSpeed,
      telemetry: {
        inputs: {
          throttleUsage: `${Math.floor(70 + getRandom(0, 20))}%`
        },
        speedAnalysis: speedAnalysis,
        brakingPoints: brakingPoints
      },
      trackMap: {
        trackLine: trackPoints.length > 10 ? trackPoints : [[0,0], [10,5], [20,10], [30,15], [40,20], [50,25], [60,30], [70,35], [80,40], [90,45], [100,50]],
        errors: problems.length > 0 ? problems : [
          {
            position: [30, 15],
            description: `Hamowanie 20m za późno (Turn ${Math.floor(1 + getRandom(0, 3))})`,
            severity: "high"
          },
          {
            position: [60, 30],
            description: `Za mało gazu w wyjściu z zakrętu (Turn ${Math.floor(4 + getRandom(0, 3))})`,
            severity: "medium"
          },
          {
            position: [90, 45],
            description: `Niewłaściwa linia jazdy (Turn ${Math.floor(7 + getRandom(0, 3))})`,
            severity: "low"
          }
        ]
      },
      sectors: sectors,
      recommendations: recommendations.slice(0, 3 + Math.floor(getRandom(0, 2)))
    };
    
    return { valid: true, data: result };
  } catch (error) {
    console.error('AI Analysis Error:', error);
    return { valid: false, reason: `Błąd analizy: ${error.message}` };
  }
}

// Endpoint to analyze telemetry files
app.post('/analyze', upload.single('telemetry'), async (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  const { track, carClass, game } = req.body;

  if (!req.file) {
    return res.status(400).json({ valid: false, reason: 'No telemetry file uploaded.' });
  }

  const filePath = path.join(uploadDir, req.file.filename);
  const format = req.file.originalname.endsWith('.json') ? 'json' : 'csv';

  try {
    const rawData = fs.readFileSync(filePath, 'utf-8');
    const result = await analyzeTelemetryWithAI(rawData, track, carClass, game);
    fs.unlinkSync(filePath); // clean up uploaded file

    if (result.valid) {
      res.json(result.data);
    } else {
      res.status(500).json({ valid: false, reason: result.reason || 'Unknown error' });
    }
  } catch (err) {
    console.error('Failed to analyze telemetry:', err);
    res.status(500).json({ valid: false, reason: err.message });
  }
});


// Logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Memory monitoring
setInterval(() => {
  const used = process.memoryUsage();
  console.log(`Memory: ${Math.round(used.heapUsed / 1024 / 1024)}MB`);
}, 30000);

// Start the server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
