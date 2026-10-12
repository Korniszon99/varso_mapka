// server.js - Prosty serwer Node.js do obsługi danych gry Varsonalia
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Short-lived bearer sessions stay in browser memory, never in the source or URL.
const sessions = new Map();
const loginAttempts = new Map();
function passwordMatches(actual, expected) {
  if (typeof actual !== 'string' || !expected || actual.length > 256) return false;
  const a = crypto.createHash('sha256').update(actual).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}
function authentication(req, res, next) {
  const session = sessions.get((req.headers.authorization || '').replace(/^Bearer /, ''));
  if (!session || session.expires <= Date.now()) return res.status(401).json({ error: 'Zaloguj się ponownie' });
  req.session = session;
  next();
}
function teamOrAdmin(req, res, next) {
  if (!/^[1-6]$/.test(req.params.teamId) || !/^(?:[0-9]|1[0-9]|2[0-4])$/.test(req.params.taskId)) {
    return res.status(400).json({ error: 'Nieprawidłowy identyfikator' });
  }
  if (req.session.role !== 'admin' && String(req.session.teamId) !== req.params.teamId) {
    return res.status(403).json({ error: 'Brak dostępu do drużyny' });
  }
  next();
}
app.post('/api/login', (req, res) => {
  const now = Date.now();
  for (const [ip, entry] of loginAttempts) if (entry.until <= now) loginAttempts.delete(ip);
  for (const [token, session] of sessions) if (session.expires <= now) sessions.delete(token);
  if (loginAttempts.size > 10000 || sessions.size > 10000) return res.sendStatus(503);
  const attempts = loginAttempts.get(req.ip) || { count: 0, until: now + 60000 };
  loginAttempts.set(req.ip, attempts);
  if (++attempts.count > 10) return res.status(429).json({ error: 'Spróbuj za minutę' });
  const { role, teamId, password } = req.body;
  if (role !== 'admin' && (role !== 'team' || !/^[1-6]$/.test(String(teamId)))) return res.sendStatus(400);
  const expected = process.env[role === 'admin' ? 'ADMIN_PASSWORD' : `TEAM_${teamId}_PASSWORD`];
  if (!passwordMatches(password, expected)) return res.sendStatus(401);
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { role, teamId, expires: now + 8 * 60 * 60 * 1000 });
  res.json({ token });
});

// Ścieżka do pliku JSON z danymi gry
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'gameData.json');

// Upewnij się, że katalog data istnieje
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Inicjalizacja pliku z danymi jeśli nie istnieje
if (!fs.existsSync(DATA_FILE)) {
  const initialData = {};
  fs.writeFileSync(DATA_FILE, JSON.stringify(initialData), 'utf8');
}

// Endpoint do pobierania danych gry
app.get('/api/game-data', (req, res) => {
  try {
    const data = fs.readFileSync(DATA_FILE, 'utf8');
    res.json(JSON.parse(data));
  } catch (error) {
    console.error('Error reading game data:', error);
    res.status(500).json({ error: 'Nie udało się pobrać danych gry' });
  }
});

// Endpoint do zapisywania danych gry
app.post('/api/game-data', authentication, (req, res) => {
  try {
    let gameData;
    if (req.session.role === 'admin') {
      gameData = req.body;
      if (!gameData || Array.isArray(gameData) || Object.keys(gameData).some(id => !/^[1-6]$/.test(id))) {
        return res.status(400).json({ error: 'Nieprawidłowe drużyny' });
      }
    } else {
      gameData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      const id = req.session.teamId;
      if (!gameData[id] || !req.body[id]) return res.sendStatus(400);
      const marked = req.body[id].bingoMarked;
      if (!marked || Array.isArray(marked) || typeof marked !== 'object' || Object.entries(marked).some(([k, v]) => !/^(?:[0-9]|1[0-9]|2[0-4])$/.test(k) || typeof v !== 'boolean')) return res.sendStatus(400);
      gameData[id].bingoMarked = marked;
      gameData[id].totalPoints = calculateTotalPoints(gameData[id]);
    }
    
    // Opcjonalna walidacja danych
    if (!gameData || typeof gameData !== 'object') {
      return res.status(400).json({ error: 'Nieprawidłowe dane gry' });
    }
    
    fs.writeFileSync(DATA_FILE, JSON.stringify(gameData), 'utf8');
    res.json({ success: true, message: 'Dane gry zostały zapisane' });
  } catch (error) {
    console.error('Error saving game data:', error);
    res.status(500).json({ error: 'Nie udało się zapisać danych gry' });
  }
});

// Endpoint do resetowania gry (tylko dla administratora)
app.post('/api/reset-game', authentication, (req, res) => {
  if (req.session.role !== 'admin') return res.sendStatus(403);

  try {
    // Generujemy nowe trasy dla wszystkich drużyn
    const baseOrder = [1, 2, 3, 4, 5, 6];
    const routes = {};

    // Dla każdej drużyny tworzymy trasę zaczynającą od innej stacji
    for (let teamId = 1; teamId <= 6; teamId++) {
      let startIndex = (teamId - 1) % 6;
      let teamRoute = [...baseOrder.slice(startIndex), ...baseOrder.slice(0, startIndex)];
      routes[teamId] = teamRoute;
    }

    // Tworzymy nowy, pusty obiekt z prawidłową strukturą
    const initialData = {
      1: { name: "Drużyna Czerwona", color: "#e74c3c", completedStations: {}, bingoMarked: {}, bingoPhotos: {}, totalPoints: 0, stationOrder: routes[1] },
      2: { name: "Drużyna Niebieska", color: "#3498db", completedStations: {}, bingoMarked: {}, bingoPhotos: {}, totalPoints: 0, stationOrder: routes[2] },
      3: { name: "Drużyna Zielona", color: "#2ecc71", completedStations: {}, bingoMarked: {}, bingoPhotos: {}, totalPoints: 0, stationOrder: routes[3] },
      4: { name: "Drużyna Żółta", color: "#f1c40f", completedStations: {}, bingoMarked: {}, bingoPhotos: {}, totalPoints: 0, stationOrder: routes[4] },
      5: { name: "Drużyna Fioletowa", color: "#9b59b6", completedStations: {}, bingoMarked: {}, bingoPhotos: {}, totalPoints: 0, stationOrder: routes[5] },
      6: { name: "Drużyna Pomarańczowa", color: "#e67e22", completedStations: {}, bingoMarked: {}, bingoPhotos: {}, totalPoints: 0, stationOrder: routes[6] }
    };

    // Zapisujemy dane początkowe
    fs.writeFileSync(DATA_FILE, JSON.stringify(initialData), 'utf8');

    // Usuwamy wszystkie zdjęcia bingo
    const uploadsDir = path.join(__dirname, 'public', 'uploads');
    if (fs.existsSync(uploadsDir)) {
      for (let teamId = 1; teamId <= 6; teamId++) {
        const teamDir = path.join(uploadsDir, teamId.toString());
        if (fs.existsSync(teamDir)) {
          fs.readdirSync(teamDir).forEach(file => {
            try {
              fs.unlinkSync(path.join(teamDir, file));
            } catch (err) {
              console.error(`Błąd podczas usuwania pliku ${file}:`, err);
            }
          });
        }
      }
    }

    res.json({ success: true, message: 'Gra została zresetowana' });
  } catch (error) {
    console.error('Error resetting game:', error);
    res.status(500).json({ error: 'Nie udało się zresetować gry' });
  }
});



// Konfiguracja zapisywania plików (zdjęcia bingo)
const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    const teamId = req.params.teamId;
    const dir = path.join(__dirname, 'public', 'uploads', teamId);

    // Stwórz folder dla drużyny jeśli nie istnieje
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    cb(null, dir);
  },
  filename: function(req, file, cb) {
    const taskId = req.params.taskId;
    const extension = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[file.mimetype];
    cb(null, `task_${taskId}${extension}`);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // Limit 5MB
  fileFilter: (req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Tylko pliki obrazów są dozwolone!'), false);
    }
  }
});

// Endpoint do przesyłania zdjęć z zadaniami bingo
app.post('/api/upload-bingo/:teamId/:taskId', authentication, teamOrAdmin, upload.single('bingoPhoto'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Brak pliku' });
    }

    const teamId = req.params.teamId;
    const taskId = req.params.taskId;
    const signature = fs.readFileSync(req.file.path);
    const isImage = (signature[0] === 0xff && signature[1] === 0xd8 && signature[2] === 0xff)
      || signature.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      || (signature.subarray(0,4).toString() === 'RIFF' && signature.subarray(8,12).toString() === 'WEBP');
    if (!isImage) { fs.unlinkSync(req.file.path); return res.status(400).json({ error: 'Nieprawidłowy obraz' }); }

    // Aktualizujemy dane gry, by oznaczyć zadanie jako wykonane z załączonym zdjęciem
    const gameDataRaw = fs.readFileSync(DATA_FILE, 'utf8');
    const gameData = JSON.parse(gameDataRaw);

    if (!gameData[teamId]) {
      return res.status(404).json({ error: 'Nie znaleziono drużyny' });
    }

    // Ustaw jako wykonane i zapisz ścieżkę do zdjęcia
    gameData[teamId].bingoMarked[taskId] = true;
    gameData[teamId].totalPoints = calculateTotalPoints(gameData[teamId]);

    // Zapisz informację o zdjęciu
    if (!gameData[teamId].bingoPhotos) {
      gameData[teamId].bingoPhotos = {};
    }

    gameData[teamId].bingoPhotos[taskId] = `/uploads/${teamId}/task_${taskId}${path.extname(req.file.filename)}`;

    // Zapisz zaktualizowane dane
    fs.writeFileSync(DATA_FILE, JSON.stringify(gameData), 'utf8');

    res.json({
      success: true,
      message: 'Zdjęcie przesłano pomyślnie',
      photoPath: gameData[teamId].bingoPhotos[taskId]
    });
  } catch (error) {
    console.error('Error uploading bingo photo:', error);
    res.status(500).json({ error: 'Nie udało się przesłać zdjęcia' });
  }
});

// Dodaj endpoint do potwierdzania punktów przez prowadzących stacje
const stationAttempts = new Map();
app.use('/api/validate-station', (req, res, next) => {
  const now = Date.now();
  for (const [ip, entry] of stationAttempts) if (entry.until <= now) stationAttempts.delete(ip);
  if (stationAttempts.size > 10000) return res.sendStatus(503);
  const entry = stationAttempts.get(req.ip) || { count: 0, until: now + 60000 };
  stationAttempts.set(req.ip, entry);
  if (++entry.count > 20) return res.sendStatus(429);
  next();
});
app.post('/api/validate-station', (req, res) => {
  const { stationPassword, teamId, stationId, points } = req.body;
  if (!/^[1-6]$/.test(String(stationId)) || !/^[1-6]$/.test(String(teamId)) || !Number.isInteger(points) || points < 0 || points > 100) return res.sendStatus(400);
  if (!passwordMatches(stationPassword, process.env[`STATION_${stationId}_PASSWORD`])) {
    return res.status(401).json({ error: 'Nieprawidłowe hasło stacji' });
  }

  try {
    const gameDataRaw = fs.readFileSync(DATA_FILE, 'utf8');
    const gameData = JSON.parse(gameDataRaw);

    if (!gameData[teamId]) {
      return res.status(404).json({ error: 'Nie znaleziono drużyny' });
    }

    // Zaktualizuj punkty za stację
    gameData[teamId].completedStations[stationId] = points;

    // Zaktualizuj łączną sumę punktów
    gameData[teamId].totalPoints = calculateTotalPoints(gameData[teamId]);

    // Zapisz zaktualizowane dane
    fs.writeFileSync(DATA_FILE, JSON.stringify(gameData), 'utf8');

    res.json({
      success: true,
      message: `Przyznano ${points} punktów drużynie na stacji ${stationId}`
    });
  } catch (error) {
    console.error('Error validating station points:', error);
    res.status(500).json({ error: 'Nie udało się zapisać punktów' });
  }
});

// Pomocnicza funkcja do obliczania łącznej liczby punktów
function calculateTotalPoints(teamData) {
  let stationsScore = 0;
  let bingoScore = 0;

  // Policz punkty ze stacji
  Object.values(teamData.completedStations).forEach(points => {
    stationsScore += points;
  });

  // Policz punkty z bingo (1 punkt za każde zaznaczone pole)
  Object.values(teamData.bingoMarked).forEach(marked => {
    if (marked) bingoScore++;
  });

  return stationsScore + bingoScore;
}

// Serwuj pliki statyczne
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));

app.use((error, req, res, next) => {
  if (req.file) fs.unlink(req.file.path, () => {});
  res.status(error instanceof multer.MulterError || error.message?.includes('obrazów') ? 400 : 500)
    .json({ error: 'Nie udało się przetworzyć żądania' });
});

// Uruchomienie serwera
module.exports = app;
if (require.main === module) app.listen(PORT, () => {
  console.log(`Serwer uruchomiony na porcie ${PORT}`);
});
