import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import './App.css';
import Modal from './components/modal';
import TrackMap from './components/TrackMap';

// Typy
type User = {
  id: string;
  email: string;
  name: string;
  password: string;
  avatar: string;
  createdAt: string;
  stats: {
    sessions: number;
    tracks: number;
    cars: number;
    totalTime: string;
    improvement: string;
  };
  history: {
    id: number;
    date: string;
    track: string;
    car: string;
    lapTime: string;
    improvement: string;
    game?: string;
    carClass?: string;
    status: string;
    tips?: string[];
    stats?: {
      lapTime: string;
      topSpeed: string;
      avgSpeed: string;
      throttleUsage: string;
      brakingPoints: number;
    };
    telemetry?: {
      speedAnalysis: Record<string, { entry: string; exit: string }>;
      brakingPoints: Record<string, string>;
    };
    sectors?: Array<{
      number: number;
      time: string;
      mistakes: Array<{
        description: string;
        solution: string;
        timeLost: string;
      }>;
    }>;
    recommendations?: string[];
  }[];
};

type TelemetryAnalysis = {
  trackPoints: [number, number][];
  errors: Array<{
    position: [number, number];
    description: string;
    severity: 'low' | 'medium' | 'high';
    sector?: number;
    timeLost?: string;
  }>;
  stats: {
    lapTime: string;
    topSpeed: string;
    avgSpeed: string;
    throttleUsage: string;
    brakingPoints: number;
  };
};

type GameData = {
  [key: string]: {
    tracks: string[];
    carClasses: string[];
  };
};

// Mock API
const api = {
  register: async (userData: Omit<User, 'id' | 'createdAt' | 'stats' | 'history'>): Promise<User> => {
    return new Promise(resolve => {
      setTimeout(() => {
        const newUser: User = {
          ...userData,
          id: Math.random().toString(36).substring(2, 9),
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
        const users = JSON.parse(localStorage.getItem('raceUsers') || '[]');
        localStorage.setItem('raceUsers', JSON.stringify([...users, newUser]));
        resolve(newUser);
      }, 800);
    });
  },
  login: async (email: string, password: string): Promise<User | null> => {
    return new Promise(resolve => {
      setTimeout(() => {
        const users: User[] = JSON.parse(localStorage.getItem('raceUsers') || '[]');
        const user = users.find(u => u.email === email && u.password === password) || null;
        resolve(user);
      }, 800);
    });
  }
};

const gameData: GameData = {
  "Le Mans Ultimate": {
    tracks: ["Bahrain", "Circuit de la Sarthe", "COTA", "Fuji", "Imola", "Interlagos", "Monza", "Portimao", "Sebring", "Spa"],
    carClasses: ["Hypercar", "LMPGT3", "LMP2", "GTE"]
  },
  "iRacing": {
    tracks: [
      "Spa-Francorchamps", "Daytona Road Course", "Watkins Glen", "Monza", "Sebring",
      "Barcelona-Catalunya", "Le Mans", "Suzuka", "Red Bull Ring", "Silverstone",
      "Mount Panorama", "Laguna Seca", "Road America", "Nürburgring GP + Nordschleife",
      "Hockenheimring", "Brands Hatch", "Donington Park", "Imola", "Zandvoort",
      "Montreal (Gilles Villeneuve)", "Virginia International Raceway", "Road Atlanta",
      "Oulton Park", "Phillip Island", "Fuji Speedway", "Interlagos",
      "COTA (Circuit of the Americas)", "Long Beach", "Mid-Ohio", "Sonoma",
      "Snetterton", "Jerez", "Magny-Cours", "MotorLand Aragón", "Oran Park"
    ],
    carClasses: [
      "GT3", "GT4", "GTE", "LMP2", "LMP3", "GTP", "TCR", "Formula 4",
      "Formula 3", "Formula 2", "Formula 1", "IndyCar"
    ]
  },
  "Assetto Corsa Competizione": {
    tracks: [
      "Spa-Francorchamps", "Monza", "Imola", "Silverstone", "Nürburgring GP",
      "Brands Hatch", "Red Bull Ring", "Barcelona-Catalunya", "Zandvoort",
      "Laguna Seca", "Suzuka", "Bathurst (Mount Panorama)", "Watkins Glen",
      "Indianapolis", "COTA", "Kyalami", "Paul Ricard", "Donington Park",
      "Snetterton", "Oulton Park", "Valencia", "Misano", "Hungaroring"
    ],
    carClasses: [
      "GT3", "GT4", "Cup (Porsche 911 GT3 Cup)",
      "Super Trofeo (Lamborghini Huracán ST)",
      "Challenger (Ferrari 488 Challenge Evo)"
    ]
  }
};

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [analysisHistory, setAnalysisHistory] = useState<any[]>([]);
  const [showModal, setShowModal] = useState<boolean>(true);


  useEffect(() => {
    const savedUser = localStorage.getItem('raceCurrentUser');
    const savedHistory = localStorage.getItem('raceHistory');
    
    if (savedUser) setUser(JSON.parse(savedUser));
    if (savedHistory) setAnalysisHistory(JSON.parse(savedHistory));
  }, []);

  const register = async (userData: Omit<User, 'id' | 'createdAt' | 'stats' | 'history'>) => {
    setLoading(true);
    setAuthError('');
    try {
      const newUser = await api.register(userData);
      setUser(newUser);
      localStorage.setItem('raceCurrentUser', JSON.stringify(newUser));
      return true;
    } catch (error) {
      setAuthError('Registration failed. Email may already be in use.');
      return false;
    } finally {
      setLoading(false);
    }
  };

  const login = async (email: string, password: string) => {
    setLoading(true);
    setAuthError('');
    try {
      const user = await api.login(email, password);
      if (user) {
        setUser(user);
        localStorage.setItem('raceCurrentUser', JSON.stringify(user));
      } else {
        setAuthError('Invalid email or password');
      }
    } catch (error) {
      setAuthError('Login failed');
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('raceCurrentUser');
  };

  const addAnalysis = (data: any) => {
    // Generate mock telemetry data based on the track
    const mockTelemetry = generateMockTelemetry(data.track);
    const mockSectors = generateMockSectors(data.track);
    const mockRecommendations = generateMockRecommendations(data.track);
    
    const newAnalysis = {
      id: Date.now(),
      date: new Date().toISOString().split('T')[0],
      status: 'completed',
      ...data,
      telemetry: mockTelemetry,
      sectors: mockSectors,
      recommendations: mockRecommendations,
      stats: {
        lapTime: generateLapTime(data.track),
        topSpeed: `${Math.floor(Math.random() * 50) + 250} km/h`,
        throttleUsage: `${Math.floor(Math.random() * 20) + 70}%`,
        brakingPoints: Math.floor(Math.random() * 5) + 3
      }
    };
  
    const updatedHistory = [newAnalysis, ...analysisHistory];
    setAnalysisHistory(updatedHistory);
    localStorage.setItem('raceHistory', JSON.stringify(updatedHistory));
  
    if (user) {
      const updatedUser = {
        ...user,
        stats: {
          ...user.stats,
          sessions: user.stats.sessions + 1,
          tracks: data.track ? user.stats.tracks + 1 : user.stats.tracks,
          cars: data.carClass ? user.stats.cars + 1 : user.stats.cars,
          improvement: `-${(Math.random() * 0.5).toFixed(2)}s`
        },
        history: [newAnalysis, ...user.history]
      };
      setUser(updatedUser);
      localStorage.setItem('raceCurrentUser', JSON.stringify(updatedUser));
  
      const users = JSON.parse(localStorage.getItem('raceUsers') || '[]');
      const updatedUsers = users.map((u: User) => 
        u.id === user.id ? updatedUser : u
      );
      localStorage.setItem('raceUsers', JSON.stringify(updatedUsers));
      useEffect(() => {
        const firstVisit = localStorage.getItem('firstVisitDone');
        if (!firstVisit) {
          setShowModal(true);
          localStorage.setItem('firstVisitDone', 'true');
        } else {
          setShowModal(false);
        }
      }, []);      
    }
  
    return newAnalysis.id;
  };

  // Helper functions for mock telemetry data
  const generateMockTelemetry = (track: string) => {
    const turns = track === 'Nürburgring' ? 16 : track === 'Spa-Francorchamps' ? 20 : 10;
    const speedAnalysis: Record<string, { entry: string; exit: string }> = {};
    
    for (let i = 1; i <= turns; i++) {
      speedAnalysis[`turn${i}`] = {
        entry: `${Math.floor(Math.random() * 50) + 150} km/h`,
        exit: `${Math.floor(Math.random() * 50) + 150} km/h`
      };
    }
    
    return {
      speedAnalysis,
      brakingPoints: Object.keys(speedAnalysis).reduce((acc, turn) => {
        acc[turn] = `${Math.floor(Math.random() * 50) + 100}m (${Math.random() > 0.5 ? 'za późno' : 'optymalnie'})`;
        return acc;
      }, {} as Record<string, string>)
    };
  };

  const generateMockSectors = (track: string) => {
    const sectorCount = track === 'Nürburgring' ? 3 : track === 'Spa-Francorchamps' ? 4 : 2;
    const sectors = [];
    
    for (let i = 1; i <= sectorCount; i++) {
      sectors.push({
        number: i,
        time: `${(Math.random() * 5 + 20).toFixed(3)}s`,
        mistakes: Array(Math.floor(Math.random() * 3)).fill(0).map((_, idx) => ({
          description: `Hamowanie ${Math.floor(Math.random() * 20) + 5}m ${Math.random() > 0.5 ? 'za późno' : 'za wcześnie'} w zakręcie ${i * 3 + idx}`,
          solution: `Hamuj od ${Math.floor(Math.random() * 50) + 80}m z ${Math.floor(Math.random() * 20) + 70}% siły`,
          timeLost: `${(Math.random() * 0.3 + 0.1).toFixed(2)}s`
        }))
      });
    }
    
    return sectors;
  };

  const generateMockRecommendations = (track: string) => {
    const recommendations = [
      `Zwiększ prędkość w zakręcie ${Math.floor(Math.random() * 5) + 1} o 10-15km/h`,
      `Utrzymuj ${Math.floor(Math.random() * 20) + 70}% gazu w sekcji ${track.includes('Spa') ? 'Eau Rouge' : 'technicznej'}`,
      `Popraw punkt hamowania w zakręcie ${Math.floor(Math.random() * 5) + 1} o 5-10m`,
      `Zoptymalizuj linię w zakręcie ${Math.floor(Math.random() * 5) + 1}`
    ];
    
    return recommendations.slice(0, Math.floor(Math.random() * 3) + 2);
  };

  const generateLapTime = (track: string) => {
    if (track === 'Nürburgring') return `6:${Math.floor(Math.random() * 30) + 30}.${Math.floor(Math.random() * 999).toString().padStart(3, '0')}`;
    if (track === 'Spa-Francorchamps') return `2:${Math.floor(Math.random() * 10) + 15}.${Math.floor(Math.random() * 999).toString().padStart(3, '0')}`;
    return `1:${Math.floor(Math.random() * 30) + 30}.${Math.floor(Math.random() * 999).toString().padStart(3, '0')}`;
  };

  return (
    <Router>
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} />
      <div className="app-container">
        <header className="header">
          <Link to="/" className="logo-link">
            <motion.h1 
              className="logo"
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.98 }}
            >
              <span className="logo-icon">🏎️</span>
              RaceSpace
            </motion.h1>
          </Link>
          
          <nav className="main-nav">
            <ul className="nav-list">
              <li className="nav-item">
                <Link to="/" className="nav-link">Home</Link>
              </li>
              {analysisHistory.length > 0 && (
                <li className="nav-item">
                  <Link to="/history" className="nav-link">History</Link>
                </li>
              )}
              {user ? (
                <>
                  <li className="nav-item">
                    <Link to="/profile" className="nav-link">Profile</Link>
                  </li>
                  <li className="nav-item">
                    <button onClick={logout} className="nav-button">
                      Logout
                    </button>
                  </li>
                </>
              ) : (
                <>
                  <li className="nav-item">
                    <Link to="/login" className="nav-link">Login</Link>
                  </li>
                  <li className="nav-item">
                    <Link to="/register" className="nav-link">Register</Link>
                  </li>
                </>
              )}
            </ul>
          </nav>
        </header>

        <main className="main-content">
          <Routes>
            <Route path="/" element={<HomePage user={user} addAnalysis={addAnalysis} gameData={gameData} />} />
            <Route path="/login" element={<LoginPage login={login} loading={loading} error={authError} />} />
            <Route path="/register" element={<RegisterPage register={register} loading={loading} error={authError} />} />
            <Route path="/profile" element={<ProfilePage user={user} />} />
            <Route path="/history" element={<HistoryPage history={analysisHistory} user={user} />} />
            <Route path="/results/:id" element={<ResultsPage history={analysisHistory} />} />
          </Routes>
        </main>

        <footer className="footer">
          <p>© {new Date().getFullYear()} RaceSpace | AI-Powered Telemetry Analysis</p>
        </footer>
      </div>
    </Router>
  );
}

function HomePage({ user, addAnalysis, gameData }: { user: User | null, addAnalysis: (data: any) => number, gameData: GameData }) {
  const [formData, setFormData] = useState({
    game: '',
    track: '',
    carClass: '',
    notes: ''
  });
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [telemetryFile, setTelemetryFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<TelemetryAnalysis | null>(null);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!telemetryFile) return;
  
    setIsAnalyzing(true);
    const formDataObj = new FormData();
    formDataObj.append('telemetry', telemetryFile);
    formDataObj.append('track', formData.track);
    formDataObj.append('carClass', formData.carClass);
    formDataObj.append('game', formData.game);
    formDataObj.append('notes', formData.notes);
  
    try {
      // Make sure your backend is running on port 5050
      const response = await fetch('http://localhost:5050/analyze', {
        method: 'POST',
        body: formDataObj,
        // Add these headers if needed by your backend
        headers: {
          'Accept': 'application/json',
        },
      });
  
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
  
      const result = await response.json();
      const analysisId = addAnalysis({
        ...formData,
        ...result,
        telemetryFile: telemetryFile.name,
        date: new Date().toISOString().split('T')[0],
        status: 'completed'
      });
  
      navigate(`/results/${analysisId}`);
    } catch (error) {
      console.error('Analysis error:', error);
      // Add visual feedback for the user
      alert('Analysis failed. Please try again.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setTelemetryFile(e.target.files[0]);
    }
  };

  return (
    <div className="home-page">
      <section className="hero-section">
        <h2>Improve Your Lap Times with AI Analysis</h2>
        <p>Upload your telemetry data and get detailed insights about your racing performance</p>
      </section>

      <div className="analysis-form-container">
        <motion.div 
          className="form-card"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
        >
          <h3>New Analysis</h3>
          
          <form onSubmit={handleSubmit}>
            <div className="form-grid">
              <div className="form-group full-width">
                <label htmlFor="telemetryFile">Telemetry File</label>
                <input
                  type="file"
                  id="telemetryFile"
                  name="telemetryFile"
                  onChange={handleFileChange}
                  accept=".csv,.json,.motec,.rdp"
                />
                <small>Supported formats: CSV, JSON, MoTeC, RDP</small>
              </div>
              
              <div className="form-group">
                <label htmlFor="game">Game</label>
                <select
                  id="game"
                  name="game"
                  value={formData.game}
                  onChange={handleInputChange}
                  required
                >
                  <option value="">Select Game</option>
                  {Object.keys(gameData).map(game => (
                    <option key={game} value={game}>{game}</option>
                  ))}
                </select>
              </div>
              
              {formData.game && (
                <>
                  <div className="form-group">
                    <label htmlFor="track">Track</label>
                    <select
                      id="track"
                      name="track"
                      value={formData.track}
                      onChange={handleInputChange}
                      required
                    >
                      <option value="">Select Track</option>
                      {gameData[formData.game].tracks.map(track => (
                        <option key={track} value={track}>{track}</option>
                      ))}
                    </select>
                  </div>
                  
                  <div className="form-group">
                    <label htmlFor="carClass">Car Class</label>
                    <select
                      id="carClass"
                      name="carClass"
                      value={formData.carClass}
                      onChange={handleInputChange}
                      required
                    >
                      <option value="">Select Class</option>
                      {gameData[formData.game].carClasses.map(carClass => (
                        <option key={carClass} value={carClass}>{carClass}</option>
                      ))}
                    </select>
                  </div>
                </>
              )}
              
              <div className="form-group full-width">
                <label htmlFor="notes">Notes (Optional)</label>
                <textarea
                  id="notes"
                  name="notes"
                  value={formData.notes}
                  onChange={handleInputChange}
                  rows={3}
                  placeholder="Any additional information about this session..."
                ></textarea>
              </div>
            </div>
            
            <div className="form-actions">
              <button 
                type="submit" 
                className="submit-button"
                disabled={isAnalyzing || !telemetryFile}
              >
                {isAnalyzing ? (
                  <>
                    <span className="loader"></span>
                    Analyzing...
                  </>
                ) : (
                  'Start Analysis'
                )}
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </div>
  );
}

function RegisterPage({ register, loading, error }: { 
  register: (userData: any) => Promise<boolean>;
  loading: boolean;
  error: string;
}) {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: ''
  });
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.password !== formData.confirmPassword) {
      alert("Passwords don't match!");
      return;
    }
    const success = await register({
      name: formData.name,
      email: formData.email,
      password: formData.password,
      avatar: `https://i.pravatar.cc/150?u=${formData.email}`
    });
    if (success) navigate('/profile');
  };

  return (
    <div className="auth-page">
      <motion.div 
        className="auth-card"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h2>Create Account</h2>
        {error && <div className="auth-error">{error}</div>}
        
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Nickname</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({...formData, name: e.target.value})}
              required
            />
          </div>
          
          <div className="form-group">
            <label>Email</label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({...formData, email: e.target.value})}
              required
            />
          </div>
          
          <div className="form-group">
            <label>Password (min 6 characters)</label>
            <input
              type="password"
              value={formData.password}
              onChange={(e) => setFormData({...formData, password: e.target.value})}
              required
              minLength={6}
            />
          </div>
          
          <div className="form-group">
            <label>Confirm Password</label>
            <input
              type="password"
              value={formData.confirmPassword}
              onChange={(e) => setFormData({...formData, confirmPassword: e.target.value})}
              required
              minLength={6}
            />
          </div>

          <button type="submit" disabled={loading} className="auth-submit">
            {loading ? <span className="loader"></span> : 'Register'}
          </button>
        </form>
        
        <p className="auth-note">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </motion.div>
    </div>
  );
}

function LoginPage({ login, loading, error }: { 
  login: (email: string, password: string) => void, 
  loading: boolean, 
  error: string 
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    login(email, password);
  };

  return (
    <div className="auth-page">
      <motion.div 
        className="auth-card"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h2>Welcome Back</h2>
        {error && <div className="auth-error">{error}</div>}
        
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          
          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button type="submit" disabled={loading} className="auth-submit">
            {loading ? <span className="loader"></span> : 'Login'}
          </button>
        </form>
        
        <p className="auth-note">
          Don't have an account? <Link to="/register">Register</Link>
        </p>
      </motion.div>
    </div>
  );
}

function ProfilePage({ user }: { user: User | null }) {
  const navigate = useNavigate();

  if (!user) {
    return (
      <div className="not-logged-in">
        <h2>Please log in to view profile</h2>
        <Link to="/login" className="btn btn-primary">
          Go to Login
        </Link>
      </div>
    );
  }

  return (
    <div className="profile-page">
      <div className="profile-header">
        <img src={user.avatar} alt="Profile" className="avatar" />
        <div className="profile-info">
          <h2>{user.name}</h2>
          <p>{user.email}</p>
          <p>Member since: {new Date(user.createdAt).toLocaleDateString()}</p>
        </div>
      </div>

      <div className="profile-stats">
        <div className="stat-card">
          <h3>Sessions</h3>
          <p>{user.stats.sessions}</p>
        </div>
        <div className="stat-card">
          <h3>Tracks</h3>
          <p>{user.stats.tracks}</p>
        </div>
        <div className="stat-card">
          <h3>Total Time</h3>
          <p>{user.stats.totalTime}</p>
        </div>
        <div className="stat-card">
          <h3>Improvement</h3>
          <p>{user.stats.improvement}</p>
        </div>
      </div>

      <div className="recent-sessions">
        <h3>Recent Sessions</h3>
        {user.history.length > 0 ? (
          user.history.slice(0, 5).map(session => (
            <div 
              key={session.id} 
              className="session-card"
              onClick={() => navigate(`/results/${session.id}`)}
            >
              <div className="session-info">
                <h4>{session.track || 'Unknown Track'}</h4>
                <p>{session.game} • {session.carClass} • {session.date}</p>
              </div>
              <div className="session-time">
                {session.stats?.lapTime || 'N/A'}
                <span className={session.improvement.startsWith('+') ? 'regression' : 'improvement'}>
                  {session.improvement}
                </span>
              </div>
            </div>
          ))
        ) : (
          <p>No sessions yet. Analyze your first telemetry file!</p>
        )}
      </div>
    </div>
  );
}

function HistoryPage({ history, user }: { history: any[], user: User | null }) {
  const navigate = useNavigate();

  if (!user) {
    return (
      <div className="not-logged-in">
        <h2>Please log in to view history</h2>
        <Link to="/login" className="btn btn-primary">
          Go to Login
        </Link>
      </div>
    );
  }

  return (
    <div className="history-page">
      <h2>Your Analysis History</h2>
      
      {history.length === 0 ? (
        <div className="no-history">
          <p>No analysis history yet</p>
          <Link to="/" className="btn btn-primary">
            Analyze First Session
          </Link>
        </div>
      ) : (
        <div className="history-list">
          {history.map((item) => (
            <div 
              key={item.id} 
              className="history-item"
              onClick={() => navigate(`/results/${item.id}`)}
            >
              <div className="item-info">
                <h3>{item.track || 'Unknown Track'}</h3>
                <p>{item.game} • {item.carClass} • {item.date}</p>
              </div>
              <div className="item-status">
                {item.status === 'completed' ? (
                  <span className="completed">Completed</span>
                ) : (
                  <span className="pending">Pending</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ResultsPage({ history }: { history: any[] }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const analysis = history.find(item => item.id === Number(id));

  if (!analysis) {
    return (
      <div className="not-found">
        <h2>Analysis not found</h2>
        <Link to="/" className="btn btn-primary">
          Back to Home
        </Link>
      </div>
    );
  }

  return (
    <div className="results-page">
      <div className="results-header">
        <h2>Analysis Results</h2>
        <p>{analysis.track || 'Unknown Track'} • {analysis.date}</p>
        {analysis.game && <p>Game: {analysis.game} • Class: {analysis.carClass}</p>}
      </div>

      {/* --- ADD THIS BLOCK --- */}
      {analysis.trackPoints && analysis.errors && (
        <TrackMap
          trackLine={analysis.trackPoints}
          errors={analysis.errors}
          onErrorSelect={(error) => {
            // Optionally scroll or highlight error details
            console.log('Selected error:', error);
          }}
        />
      )}

      <div className="analysis-stats">
        <div className="stat">
          <h3>Lap Time</h3>
          <p>{analysis.stats?.lapTime || 'N/A'}</p>
        </div>
        <div className="stat">
          <h3>Top Speed</h3>
          <p>{analysis.stats?.topSpeed || 'N/A'}</p>
        </div>
        <div className="stat">
          <h3>Throttle Usage</h3>
          <p>{analysis.stats?.throttleUsage || 'N/A'}</p>
        </div>
        <div className="stat">
          <h3>Braking Points</h3>
          <p>{analysis.stats?.brakingPoints || 'N/A'}</p>
        </div>
      </div>

      <div className="telemetry-section">
        <h3>Speed Analysis</h3>
        {analysis.telemetry?.speedAnalysis ? (
          <ul>
            {Object.entries(analysis.telemetry.speedAnalysis).map(([turn, data]: any, index) => (
              <li key={index}>
                <strong>{turn}:</strong> Entry {data.entry}, Exit {data.exit}
              </li>
            ))}
          </ul>
        ) : (
          <p>No speed data available</p>
        )}
      </div>

      <div className="telemetry-section">
        <h3>Braking Points</h3>
        {analysis.telemetry?.brakingPoints ? (
          <ul>
            {Object.entries(analysis.telemetry.brakingPoints).map(([turn, point]: any, index) => (
              <li key={index}>
                <strong>{turn}:</strong> {point}
              </li>
            ))}
          </ul>
        ) : (
          <p>No braking data available</p>
        )}
      </div>

      <div className="sectors-section">
        <h3>Sector Analysis</h3>
        {analysis.sectors?.length > 0 ? (
          <ul>
            {analysis.sectors.map((sector: any, index: number) => (
              <li key={index}>
                <strong>Sector {sector.number}:</strong> {sector.time}
                {sector.mistakes.length > 0 && (
                  <>
                    <br />
                    <span>Mistakes:</span>
                    <ul>
                      {sector.mistakes.map((mistake: any, idx: number) => (
                        <li key={idx}>
                          {mistake.description} — {mistake.solution} (Time lost: {mistake.timeLost})
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p>No sector data available</p>
        )}
      </div>

      <div className="recommendations-section">
        <h3>AI Recommendations</h3>
        {analysis.recommendations?.length > 0 ? (
          <ul>
            {analysis.recommendations.map((rec: string, index: number) => (
              <li key={index}>{rec}</li>
            ))}
          </ul>
        ) : (
          <p>No recommendations available</p>
        )}
      </div>

      <button 
        onClick={() => navigate('/')} 
        className="btn btn-primary"
      >
        Analyze Another Session
      </button>
    </div>
  );
}

export default App;
