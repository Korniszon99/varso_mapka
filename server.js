// server.js - Prosty serwer Node.js do obsługi danych gry Varsonalia
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
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

// Uruchomienie serwera
app.listen(PORT, () => {
  console.log(`Serwer uruchomiony na porcie ${PORT}`);
});
