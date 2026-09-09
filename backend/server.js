const express = require('express');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '.env') });

let sqlite3 = null;

try {
  sqlite3 = require('sqlite3').verbose();
} catch (error) {
  console.warn('SQLite3 package is not installed. Falling back to in-memory caching and session-only persistence.');
}

const app = express();
const PORT = process.env.PORT || 5000;
const API_KEY = process.env.EXCHANGE_RATE_API_KEY;
const DB_PATH = path.join(__dirname, 'currency_app.db');
const RATE_CACHE_TTL_MS = 60 * 60 * 1000;

const inMemoryRateCache = new Map();
const inMemoryHistory = [];
const inMemoryFavorites = [];

app.use(cors());
app.use(express.json());

function migrateRateCacheTable(localDb) {
  localDb.all('PRAGMA table_info(rate_cache)', (err, columns) => {
    if (err) {
      console.error('Failed to inspect rate_cache schema:', err.message);
      return;
    }

    const hasExpiresAt = columns.some((column) => column.name === 'expires_at');

    if (!hasExpiresAt) {
      localDb.run('ALTER TABLE rate_cache ADD COLUMN expires_at TEXT', (alterErr) => {
        if (alterErr) {
          console.error('Failed to migrate rate_cache table:', alterErr.message);
        }
      });
    }
  });
}

function initDB() {
  if (!sqlite3) {
    return null;
  }

  const localDb = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
      console.error('Failed to open SQLite database:', err.message);
      return;
    }

    localDb.serialize(() => {
      localDb.run(`
        CREATE TABLE IF NOT EXISTS conversions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          from_currency TEXT NOT NULL,
          to_currency TEXT NOT NULL,
          amount REAL NOT NULL,
          result REAL NOT NULL,
          rate REAL NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      localDb.run(`
        CREATE TABLE IF NOT EXISTS favorites (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          from_currency TEXT NOT NULL,
          to_currency TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(from_currency, to_currency)
        )
      `);

      localDb.run(`
        CREATE TABLE IF NOT EXISTS rate_cache (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          base_currency TEXT NOT NULL,
          conversion_rates TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(base_currency)
        )
      `);

      migrateRateCacheTable(localDb);
    });
  });

  return localDb;
}

const db = initDB();

const majorCurrencies = [
  'USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'CNY', 'INR', 'AED', 'SAR', 'SGD', 'NZD', 'SEK', 'NOK'
];

const regionalCurrencies = [
  'INR', 'AED', 'SAR', 'ZAR', 'NGN', 'EGP', 'BDT', 'PKR', 'LKR', 'VND', 'THB', 'MYR', 'IDR', 'PHP', 'KRW'
];

const supportedCurrencies = [...new Set([...majorCurrencies, ...regionalCurrencies])].sort();
const travelBudgetCurrencies = ['USD', 'EUR', 'GBP', 'JPY', 'AUD'];

function normalizeCurrency(currency) {
  return String(currency || '').toUpperCase();
}

function formatCurrencyOptions(currencyData) {
  if (!currencyData) {
    return [];
  }

  const items = Array.isArray(currencyData)
    ? currencyData
    : Object.entries(currencyData);

  return items
    .map(([code, details]) => {
      if (typeof code === 'string' && typeof details === 'string') {
        return { code: normalizeCurrency(code), name: details };
      }

      const normalizedCode = normalizeCurrency(code || details?.code || details?.currency || details?.id || '');

      if (!normalizedCode) {
        return null;
      }

      return {
        code: normalizedCode,
        name: details?.name || details?.currency || details?.country || normalizedCode,
        symbol: details?.symbol || ''
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.code.localeCompare(b.code));
}

function extractRatesFromCurrencyApiResponse(data) {
  if (!data || !data.data || typeof data.data !== 'object') {
    return null;
  }

  const rates = {};

  Object.entries(data.data).forEach(([currency, payload]) => {
    const rawValue = payload && typeof payload === 'object' ? payload.value : payload;

    if (rawValue !== undefined && rawValue !== null) {
      rates[currency] = Number(rawValue);
    }
  });

  return Object.keys(rates).length ? rates : null;
}

function getTodayDateKey() {
  return new Date().toISOString().slice(0, 10);
}

function saveRateCache(baseCurrency, rates, ttlMs = RATE_CACHE_TTL_MS) {
  const normalized = normalizeCurrency(baseCurrency);
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  const dateKey = getTodayDateKey();

  inMemoryRateCache.set(normalized, { rates, expiresAt, dateKey });

  if (!db) {
    return;
  }

  db.run(
    `INSERT OR REPLACE INTO rate_cache (base_currency, conversion_rates, expires_at, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
    [normalized, JSON.stringify(rates), expiresAt],
    (err) => {
      if (err) {
        console.error('Failed to write rate cache:', err.message);
      }
    }
  );
}

function getCachedRateEntry(baseCurrency) {
  const normalized = normalizeCurrency(baseCurrency);
  const todayDateKey = getTodayDateKey();

  const memoryEntry = inMemoryRateCache.get(normalized);

  if (memoryEntry && memoryEntry.dateKey === todayDateKey) {
    return Promise.resolve(memoryEntry.rates);
  }

  if (memoryEntry) {
    inMemoryRateCache.delete(normalized);
  }

  if (!db) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    db.get(
      `SELECT conversion_rates, created_at FROM rate_cache WHERE base_currency = ? ORDER BY created_at DESC LIMIT 1`,
      [normalized],
      (err, row) => {
        if (err) {
          console.error('Failed to read rate cache:', err.message);
          return resolve(null);
        }

        if (!row) {
          return resolve(null);
        }

        const cachedDateKey = row.created_at ? row.created_at.slice(0, 10) : null;

        if (cachedDateKey !== todayDateKey) {
          db.run(`DELETE FROM rate_cache WHERE base_currency = ?`, [normalized]);
          return resolve(null);
        }

        try {
          const rates = JSON.parse(row.conversion_rates);
          inMemoryRateCache.set(normalized, { rates, dateKey: cachedDateKey });
          resolve(rates);
        } catch (parseError) {
          resolve(null);
        }
      }
    );
  });
}

function addConversionHistory(entry) {
  const historyEntry = {
    ...entry,
    created_at: new Date().toISOString()
  };

  inMemoryHistory.unshift(historyEntry);

  if (inMemoryHistory.length > 20) {
    inMemoryHistory.length = 20;
  }

  if (!db) {
    return;
  }

  db.run(
    `INSERT INTO conversions (from_currency, to_currency, amount, result, rate) VALUES (?, ?, ?, ?, ?)`,
    [entry.fromCurrency, entry.toCurrency, entry.amount, entry.result, entry.rate],
    (err) => {
      if (err) {
        console.error('Failed to store conversion history:', err.message);
      }
    }
  );
}

function addFavorite(fromCurrency, toCurrency) {
  if (!db) {
    const alreadyExists = inMemoryFavorites.some(
      (favorite) => favorite.from_currency === fromCurrency && favorite.to_currency === toCurrency
    );

    if (!alreadyExists) {
      inMemoryFavorites.unshift({ from_currency: fromCurrency, to_currency: toCurrency });
    }

    return;
  }

  db.run(
    `INSERT OR IGNORE INTO favorites (from_currency, to_currency) VALUES (?, ?)`,
    [fromCurrency, toCurrency],
    (err) => {
      if (err) {
        console.error('Failed to save favorite:', err.message);
      }
    }
  );
}

function removeFavorite(fromCurrency, toCurrency) {
  if (!db) {
    const index = inMemoryFavorites.findIndex(
      (favorite) => favorite.from_currency === fromCurrency && favorite.to_currency === toCurrency
    );

    if (index !== -1) {
      inMemoryFavorites.splice(index, 1);
    }

    return;
  }

  db.run(
    `DELETE FROM favorites WHERE from_currency = ? AND to_currency = ?`,
    [fromCurrency, toCurrency],
    (err) => {
      if (err) {
        console.error('Failed to remove favorite:', err.message);
      }
    }
  );
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', persistenceMode: db ? 'sqlite' : 'memory' });
});

app.get('/api/currencies', async (req, res) => {
  const fallbackCurrencies = supportedCurrencies.map((currency) => ({
    code: currency,
    name: currency
  }));

  if (!API_KEY) {
    return res.json({ currencies: fallbackCurrencies });
  }

  try {
    const response = await fetch(`https://api.currencyapi.com/v3/currencies?apikey=${API_KEY}`);

    if (!response.ok) {
      throw new Error('Failed to fetch currencies from CurrencyAPI');
    }

    const text = await response.text();
    let data;

    try {
      data = JSON.parse(text);
    } catch (parseError) {
      throw new Error('Invalid currencies response from CurrencyAPI');
    }

    const formattedCurrencies = formatCurrencyOptions(data?.data || data?.currencies || {});

    if (!formattedCurrencies.length) {
      throw new Error('No currencies returned by CurrencyAPI');
    }

    return res.json({ currencies: formattedCurrencies });
  } catch (error) {
    return res.json({ currencies: fallbackCurrencies, warning: error.message });
  }
});

app.get('/api/rates', async (req, res) => {
  const base = normalizeCurrency(req.query.base || 'USD');

  if (!API_KEY) {
    return res.status(500).json({
      error: 'Missing EXCHANGE_RATE_API_KEY. Please set it in backend/.env and use a valid API key.'
    });
  }

  const cachedRates = await getCachedRateEntry(base);

  if (cachedRates) {
    return res.json({
      base,
      rates: cachedRates,
      date: new Date().toISOString(),
      fromCache: true
    });
  }

  try {
    const response = await fetch(`https://api.currencyapi.com/v3/latest?apikey=${API_KEY}&base_currency=${base}`);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || 'Failed to fetch live rates from CurrencyAPI');
    }

    const text = await response.text();
    let data;

    try {
      data = JSON.parse(text);
    } catch (parseError) {
      throw new Error('Invalid JSON received from CurrencyAPI');
    }

    const rates = extractRatesFromCurrencyApiResponse(data);

    if (!rates) {
      throw new Error('Invalid API response format');
    }

    saveRateCache(base, rates);

    res.json({
      base,
      rates,
      date: data.meta?.last_updated_at || new Date().toISOString(),
      fromCache: false
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Unable to fetch live rates' });
  }
});

app.get('/api/travel-budget', async (req, res) => {
  const base = normalizeCurrency(req.query.base || 'USD');
  const amount = Number(req.query.amount ?? 0);

  if (!Number.isFinite(amount) || amount < 0) {
    return res.status(400).json({ error: 'A valid non-negative amount is required.' });
  }

  if (!API_KEY) {
    return res.status(500).json({
      error: 'Missing EXCHANGE_RATE_API_KEY. Please set it in backend/.env and use a valid API key.'
    });
  }

  try {
    let rates = await getCachedRateEntry(base);

    if (!rates) {
      const response = await fetch(
        `https://api.currencyapi.com/v3/latest?apikey=${API_KEY}&base_currency=${base}`
      );

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Failed to fetch live rates from CurrencyAPI');
      }

      const text = await response.text();
      let data;

      try {
        data = JSON.parse(text);
      } catch (parseError) {
        throw new Error('Invalid JSON received from CurrencyAPI');
      }

      rates = extractRatesFromCurrencyApiResponse(data);

      if (!rates) {
        throw new Error('Invalid API response format');
      }

      saveRateCache(base, rates);
    }

    const comparison = travelBudgetCurrencies.map((currency) => {
      const rate = rates[currency];

      return {
        currency,
        rate: rate ?? null,
        equivalent: rate !== undefined && rate !== null ? Number((amount * rate).toFixed(2)) : null
      };
    });

    return res.json({
      base,
      amount,
      comparison
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Unable to generate travel budget comparison.' });
  }
});

app.get('/api/historical', async (req, res) => {
  const { base = 'USD', target = 'INR', days = 30 } = req.query;

  if (!API_KEY) {
    return res.status(500).json({
      error: 'Missing EXCHANGE_RATE_API_KEY. Please set it in backend/.env and use a valid API key.'
    });
  }

  try {
    const history = [];
    const dayCount = Math.min(parseInt(days, 10) || 30, 365);

    const today = new Date();

    for (let i = dayCount - 1; i >= 0; i -= 1) {
      const date = new Date(today);
      date.setDate(today.getDate() - i);
      const formattedDate = date.toISOString().slice(0, 10);

      const response = await fetch(
        `https://api.currencyapi.com/v3/historical?apikey=${API_KEY}&date=${formattedDate}&base_currency=${base}&currencies=${target}`
      );

      if (!response.ok) {
        continue;
      }

      const text = await response.text();
      let data;

      try {
        data = JSON.parse(text);
      } catch (parseError) {
        continue;
      }

      const rates = extractRatesFromCurrencyApiResponse(data);
      const rate = rates?.[target] || null;

      if (rate) {
        history.push({
          date: formattedDate,
          rate
        });
      }
    }

    if (history.length === 0) {
      return res.status(500).json({ error: 'No historical data available for the requested pair.' });
    }

    res.json({ base, target, history });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Unable to fetch historical rates' });
  }
});

app.post('/api/convert', async (req, res) => {
  const { fromCurrency, toCurrency, amount } = req.body;

  if (!fromCurrency || !toCurrency || amount === undefined) {
    return res.status(400).json({ error: 'fromCurrency, toCurrency, and amount are required.' });
  }

  const numericAmount = Number(amount);

  if (Number.isNaN(numericAmount)) {
    return res.status(400).json({ error: 'Amount must be a valid number.' });
  }

  if (!API_KEY) {
    return res.status(500).json({
      error: 'Missing EXCHANGE_RATE_API_KEY. Please add your ExchangeRate API key in backend/.env.'
    });
  }

  try {
    let rates = await getCachedRateEntry(fromCurrency);

    if (!rates) {
      const response = await fetch(`https://api.currencyapi.com/v3/latest?apikey=${API_KEY}&base_currency=${fromCurrency}`);

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Failed to fetch live rates from CurrencyAPI');
      }

      const text = await response.text();
      let data;

      try {
        data = JSON.parse(text);
      } catch (parseError) {
        throw new Error('Invalid JSON received from CurrencyAPI');
      }

      const parsedRates = extractRatesFromCurrencyApiResponse(data);

      if (!parsedRates) {
        throw new Error('Invalid API response format');
      }

      rates = parsedRates;
      saveRateCache(fromCurrency, rates);
    }

    const rate = rates[toCurrency];

    if (!rate) {
      return res.status(400).json({ error: 'Unsupported currency conversion.' });
    }

    const result = numericAmount * rate;

    addConversionHistory({
      fromCurrency,
      toCurrency,
      amount: numericAmount,
      result,
      rate
    });

    return res.json({ rate, result, amount: numericAmount, fromCurrency, toCurrency });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Unable to convert currency.' });
  }
});

app.get('/api/history', (req, res) => {
  if (!db) {
    return res.json({ history: inMemoryHistory.slice(0, 20) });
  }

  db.all(
    `SELECT from_currency, to_currency, amount, result, rate, created_at FROM conversions ORDER BY created_at DESC LIMIT 20`,
    [],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to fetch conversion history.' });
      }

      res.json({ history: rows });
    }
  );
});

app.get('/api/favorites', (req, res) => {
  if (!db) {
    return res.json({ favorites: inMemoryFavorites });
  }

  db.all(
    `SELECT from_currency, to_currency FROM favorites ORDER BY created_at DESC`,
    [],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to fetch favorites.' });
      }

      res.json({ favorites: rows });
    }
  );
});

app.post('/api/favorites', (req, res) => {
  const { fromCurrency, toCurrency } = req.body;

  if (!fromCurrency || !toCurrency) {
    return res.status(400).json({ error: 'fromCurrency and toCurrency are required.' });
  }

  if (!db) {
    addFavorite(fromCurrency, toCurrency);
    return res.json({ success: true });
  }

  db.run(
    `INSERT OR IGNORE INTO favorites (from_currency, to_currency) VALUES (?, ?)`,
    [fromCurrency, toCurrency],
    function (err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to save favorite.' });
      }

      res.json({ success: true, id: this.lastID });
    }
  );
});

app.delete('/api/favorites', (req, res) => {
  const { fromCurrency, toCurrency } = req.query;

  if (!fromCurrency || !toCurrency) {
    return res.status(400).json({ error: 'fromCurrency and toCurrency are required.' });
  }

  if (!db) {
    removeFavorite(fromCurrency, toCurrency);
    return res.json({ success: true, deleted: true });
  }

  db.run(
    `DELETE FROM favorites WHERE from_currency = ? AND to_currency = ?`,
    [fromCurrency, toCurrency],
    function (err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to remove favorite.' });
      }

      res.json({ success: true, deleted: this.changes > 0 });
    }
  );
});

app.listen(PORT, () => {
  console.log(`Backend server listening on http://localhost:${PORT}`);
  if (db) {
    console.log('SQLite persistence enabled.');
  } else {
    console.log('SQLite not available; using in-memory cache and session-only persistence.');
  }
});
