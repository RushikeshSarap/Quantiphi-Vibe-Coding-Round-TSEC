const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const API_KEY = process.env.EXCHANGE_RATE_API_KEY;
const DB_PATH = path.join(__dirname, 'currency_app.db');

app.use(cors());
app.use(express.json());

function initDB() {
  const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
      console.error('Failed to open SQLite database:', err.message);
      return;
    }

    db.serialize(() => {
      db.run(`
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

      db.run(`
        CREATE TABLE IF NOT EXISTS favorites (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          from_currency TEXT NOT NULL,
          to_currency TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(from_currency, to_currency)
        )
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS rate_cache (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          base_currency TEXT NOT NULL,
          conversion_rates TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(base_currency)
        )
      `);
    });
  });

  return db;
}

const db = initDB();

const majorCurrencies = [
  'USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'CNY', 'INR', 'AED', 'SAR', 'SGD', 'NZD', 'SEK', 'NOK'
];

const regionalCurrencies = [
  'INR', 'AED', 'SAR', 'ZAR', 'NGN', 'EGP', 'BDT', 'PKR', 'LKR', 'VND', 'THB', 'MYR', 'IDR', 'PHP', 'KRW'
];

const supportedCurrencies = [...new Set([...majorCurrencies, ...regionalCurrencies])].sort();

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/currencies', (req, res) => {
  res.json({ currencies: supportedCurrencies });
});

app.get('/api/rates', async (req, res) => {
  const { base = 'USD' } = req.query;

  if (!API_KEY) {
    return res.status(500).json({
      error: 'Missing EXCHANGE_RATE_API_KEY. Please set it in backend/.env and use a valid API key.'
    });
  }

  try {
    const response = await fetch(`https://v6.exchangerate-api.com/v6/${API_KEY}/latest/${base}`);

    if (!response.ok) {
      throw new Error('Failed to fetch live rates from ExchangeRate API');
    }

    const data = await response.json();

    if (!data.conversion_rates) {
      throw new Error('Invalid API response format');
    }

    res.json({
      base,
      rates: data.conversion_rates,
      date: data.time_last_update_utc || new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Unable to fetch live rates' });
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
        `https://v6.exchangerate-api.com/v6/${API_KEY}/history/${base}/${formattedDate}`
      );

      if (!response.ok) {
        continue;
      }

      const data = await response.json();
      const rate = data.conversion_rates?.[target] || null;

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

app.post('/api/convert', (req, res) => {
  const { fromCurrency, toCurrency, amount } = req.body;

  if (!API_KEY) {
    return res.status(500).json({
      error: 'Missing EXCHANGE_RATE_API_KEY. Please add your ExchangeRate API key in backend/.env.'
    });
  }

  if (!fromCurrency || !toCurrency || amount === undefined) {
    return res.status(400).json({ error: 'fromCurrency, toCurrency, and amount are required.' });
  }

  const numericAmount = Number(amount);

  if (Number.isNaN(numericAmount)) {
    return res.status(400).json({ error: 'Amount must be a valid number.' });
  }

  db.serialize(() => {
    db.get(
      `SELECT conversion_rates FROM rate_cache WHERE base_currency = ? AND created_at >= datetime('now', '-1 hour') LIMIT 1`,
      [fromCurrency],
      async (err, row) => {
        if (err) {
          return res.status(500).json({ error: 'Failed to read cache.' });
        }

        if (row && row.conversion_rates) {
          const rates = JSON.parse(row.conversion_rates);
          const rate = rates[toCurrency] || 0;
          const result = numericAmount * rate;

          db.run(
            `INSERT INTO conversions (from_currency, to_currency, amount, result, rate) VALUES (?, ?, ?, ?, ?)`,
            [fromCurrency, toCurrency, numericAmount, result, rate],
            (insertErr) => {
              if (insertErr) {
                return res.status(500).json({ error: 'Failed to store conversion history.' });
              }

              return res.json({ rate, result, amount: numericAmount, fromCurrency, toCurrency });
            }
          );
          return;
        }

        try {
          const response = await fetch(`https://v6.exchangerate-api.com/v6/${API_KEY}/latest/${fromCurrency}`);
          const data = await response.json();

          if (!data.conversion_rates || !data.conversion_rates[toCurrency]) {
            return res.status(400).json({ error: 'Unsupported currency conversion.' });
          }

          const rate = data.conversion_rates[toCurrency];
          const result = numericAmount * rate;

          db.run(
            `INSERT INTO conversions (from_currency, to_currency, amount, result, rate) VALUES (?, ?, ?, ?, ?)`,
            [fromCurrency, toCurrency, numericAmount, result, rate],
            (insertErr) => {
              if (insertErr) {
                return res.status(500).json({ error: 'Failed to store conversion history.' });
              }

              db.run(
                `INSERT OR REPLACE INTO rate_cache (base_currency, conversion_rates, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)`,
                [fromCurrency, JSON.stringify(data.conversion_rates)],
                (cacheErr) => {
                  if (cacheErr) {
                    console.error('Failed to store rate cache:', cacheErr.message);
                  }

                  return res.json({ rate, result, amount: numericAmount, fromCurrency, toCurrency });
                }
              );
            }
          );
        } catch (error) {
          res.status(500).json({ error: error.message || 'Unable to convert currency.' });
        }
      }
    );
  });
});

app.get('/api/history', (req, res) => {
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
});
