// server.js - Prosty serwer Node.js do obsługi danych gry Varsonalia
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Ścieżka do pliku JSON z danymi gry
const DATA_FILE = path.join(__dirname, 'data', 'gameData.json');

// Upewnij się, że katalog data istnieje
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'));
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
app.post('/api/game-data', (req, res) => {
  try {
    const gameData = req.body;
    
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
app.post('/api/reset-game', (req, res) => {
  const { adminPassword } = req.body;
  const ADMIN_PASSWORD = "varsonalia2025"; // To powinno być przechowywane w zmiennych środowiskowych
  
  if (adminPassword !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Nieautoryzowany dostęp' });
  }
  
  try {
    const initialData = {};
    fs.writeFileSync(DATA_FILE, JSON.stringify(initialData), 'utf8');
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
    const extension = path.extname(file.originalname);
    cb(null, `task_${taskId}${extension}`);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // Limit 5MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Tylko pliki obrazów są dozwolone!'), false);
    }
  }
});

// Endpoint do przesyłania zdjęć z zadaniami bingo
app.post('/api/upload-bingo/:teamId/:taskId', upload.single('bingoPhoto'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Brak pliku' });
    }

    const teamId = req.params.teamId;
    const taskId = req.params.taskId;

    // Aktualizujemy dane gry, by oznaczyć zadanie jako wykonane z załączonym zdjęciem
    const gameDataRaw = fs.readFileSync(DATA_FILE, 'utf8');
    const gameData = JSON.parse(gameDataRaw);

    if (!gameData[teamId]) {
      return res.status(404).json({ error: 'Nie znaleziono drużyny' });
    }

    // Ustaw jako wykonane i zapisz ścieżkę do zdjęcia
    gameData[teamId].bingoMarked[taskId] = true;

    // Zapisz informację o zdjęciu
    if (!gameData[teamId].bingoPhotos) {
      gameData[teamId].bingoPhotos = {};
    }

    gameData[teamId].bingoPhotos[taskId] = `/uploads/${teamId}/task_${taskId}${path.extname(req.file.originalname)}`;

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
app.post('/api/validate-station', (req, res) => {
  const { stationPassword, teamId, stationId, points } = req.body;
  const STATION_PASSWORDS = {
    1: "stacjaPW",
    2: "escaperoom",
    3: "strzelaj",
    4: "joga",
    5: "hamaki",
    6: "juwe"
  };

  // Sprawdź hasło stacji
  if (stationPassword !== STATION_PASSWORDS[stationId]) {
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

// Uruchomienie serwera
app.listen(PORT, () => {
  console.log(`Serwer uruchomiony na porcie ${PORT}`);
});
