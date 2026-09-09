import { useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, Star, TrendingUp, History, RefreshCw } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000';

const defaultCurrencies = ['USD', 'EUR', 'GBP', 'INR', 'JPY', 'AED', 'SAR', 'AUD', 'CAD', 'CHF'];

const normalizeCurrencyOptions = (items) =>
  items.map((currency) => {
    if (typeof currency === 'string') {
      return { code: currency, name: currency };
    }

    return {
      code: currency.code || currency.currency || currency.id,
      name: currency.name || currency.currency || currency.code || currency.id,
      symbol: currency.symbol || ''
    };
  });

function App() {
  const [currencies, setCurrencies] = useState(normalizeCurrencyOptions(defaultCurrencies));
  const [fromCurrency, setFromCurrency] = useState('USD');
  const [toCurrency, setToCurrency] = useState('INR');
  const [amount, setAmount] = useState('100');
  const [convertedAmount, setConvertedAmount] = useState(null);
  const [rate, setRate] = useState(null);
  const [favorites, setFavorites] = useState([]);
  const [history, setHistory] = useState([]);
  const [historicalData, setHistoricalData] = useState([]);
  const [travelMode, setTravelMode] = useState(false);
  const [travelBudget, setTravelBudget] = useState([]);
  const [travelLoading, setTravelLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadCurrencies();
    loadFavorites();
    loadHistory();
  }, []);

  useEffect(() => {
    if (fromCurrency && toCurrency) {
      loadHistoricalTrend(fromCurrency, toCurrency);
    }
  }, [fromCurrency, toCurrency]);

  useEffect(() => {
    if (travelMode) {
      loadTravelBudgetComparison();
    }
  }, [travelMode, fromCurrency, amount]);

  const loadCurrencies = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/currencies`);
      const data = await response.json();

      if (data.currencies?.length) {
        setCurrencies(normalizeCurrencyOptions(data.currencies));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const loadFavorites = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/favorites`);
      const data = await response.json();
      setFavorites(data.favorites || []);
    } catch (err) {
      console.error(err);
    }
  };

  const loadHistory = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/history`);
      const data = await response.json();
      setHistory(data.history || []);
    } catch (err) {
      console.error(err);
    }
  };

  const loadTravelBudgetComparison = async () => {
    if (!travelMode) {
      return;
    }

    setTravelLoading(true);

    try {
      const response = await fetch(
        `${API_BASE}/api/travel-budget?base=${fromCurrency}&amount=${amount}`
      );
      const data = await response.json();

      if (response.ok) {
        setTravelBudget(data.comparison || []);
      } else {
        setTravelBudget([]);
        setError(data.error || 'Unable to load travel budget');
      }
    } catch (err) {
      setTravelBudget([]);
      setError('Unable to load travel budget');
    } finally {
      setTravelLoading(false);
    }
  };

  const loadHistoricalTrend = async (base, target) => {
    try {
      const response = await fetch(
        `${API_BASE}/api/historical?base=${base}&target=${target}&days=30`
      );
      const data = await response.json();

      if (data.history) {
        setHistoricalData(data.history);
      }
    } catch (err) {
      console.error(err);
      setHistoricalData([]);
    }
  };

  const handleConvert = async () => {
    setLoading(true);
    setError('');

    try {
      const response = await fetch(`${API_BASE}/api/convert`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          fromCurrency,
          toCurrency,
          amount: Number(amount)
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Conversion failed');
      }

      setConvertedAmount(data.result.toFixed(2));
      setRate(data.rate.toFixed(4));
      loadHistory();
    } catch (err) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const toggleFavorite = async () => {
    const exists = favorites.some(
      (favorite) => favorite.from_currency === fromCurrency && favorite.to_currency === toCurrency
    );

    try {
      if (exists) {
        await fetch(
          `${API_BASE}/api/favorites?fromCurrency=${fromCurrency}&toCurrency=${toCurrency}`,
          { method: 'DELETE' }
        );
        setFavorites((prev) =>
          prev.filter(
            (favorite) => !(favorite.from_currency === fromCurrency && favorite.to_currency === toCurrency)
          )
        );
      } else {
        const response = await fetch(`${API_BASE}/api/favorites`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fromCurrency, toCurrency })
        });

        if (response.ok) {
          loadFavorites();
        }
      }
    } catch (err) {
      console.error('Favorite update failed', err);
    }
  };

  const trendSummary = useMemo(() => {
    if (!historicalData.length) {
      return { change: 'N/A', current: 'N/A' };
    }

    const first = historicalData[0].rate;
    const last = historicalData[historicalData.length - 1].rate;
    const change = (((last - first) / first) * 100).toFixed(2);

    return {
      change,
      current: last.toFixed(4)
    };
  }, [historicalData]);

  const favoritePairs = favorites.length
    ? favorites
    : [
        { from_currency: 'USD', to_currency: 'INR' },
        { from_currency: 'EUR', to_currency: 'USD' },
        { from_currency: 'GBP', to_currency: 'JPY' }
      ];

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.25em] text-cyan-400">Finance Suite</p>
            <h1 className="mt-2 text-3xl font-bold md:text-4xl">Currency Converter</h1>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setTravelMode((prev) => !prev)}
              className="inline-flex items-center justify-center rounded-xl border border-cyan-500 bg-cyan-50 px-5 py-3 font-medium text-cyan-700 transition hover:bg-cyan-100"
            >
              {travelMode ? 'Exit Travel Budgeting' : 'Travel Budgeting'}
            </button>
            <button
              onClick={handleConvert}
              className="inline-flex items-center justify-center rounded-xl bg-cyan-500 px-5 py-3 font-medium text-slate-950 transition hover:bg-cyan-400"
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Convert Now
            </button>
          </div>
        </header>

        <main className="space-y-8">
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-md shadow-slate-200/80">
            <div className="grid gap-4 lg:grid-cols-[1fr_auto_1fr] lg:items-end">
              <div>
                <label className="mb-2 block text-sm text-slate-300">Source Currency</label>
                <select
                  value={fromCurrency}
                  onChange={(e) => setFromCurrency(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-lg text-white outline-none transition focus:border-cyan-400"
                >
                  {currencies.map((currency) => (
                    <option key={`from-${currency.code}`} value={currency.code}>
                      {currency.code} - {currency.name}
                    </option>
                  ))}
                </select>
              </div>

              <button
                onClick={() => {
                  setFromCurrency(toCurrency);
                  setToCurrency(fromCurrency);
                }}
                className="flex h-12 w-12 items-center justify-center rounded-full border border-slate-700 bg-slate-800 text-cyan-400 transition hover:border-cyan-400 hover:bg-slate-700"
                aria-label="Swap currencies"
              >
                <ArrowRightLeft className="h-5 w-5" />
              </button>

              <div>
                <label className="mb-2 block text-sm text-slate-300">Target Currency</label>
                <select
                  value={toCurrency}
                  onChange={(e) => setToCurrency(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-lg text-white outline-none transition focus:border-cyan-400"
                >
                  {currencies.map((currency) => (
                    <option key={`to-${currency.code}`} value={currency.code}>
                      {currency.code} - {currency.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-6 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
              <div>
                <label className="mb-2 block text-sm text-slate-300">Amount</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-lg text-white outline-none transition focus:border-cyan-400"
                />
              </div>

              <div className="flex items-end justify-between gap-3 rounded-xl border border-slate-700 bg-slate-950 p-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Current Rate</p>
                  <p className="mt-2 text-2xl font-semibold text-cyan-400">
                    {rate ? `1 ${fromCurrency} = ${rate} ${toCurrency}` : '---'}
                  </p>
                </div>
                <button
                  onClick={toggleFavorite}
                  className="rounded-full border border-yellow-500/40 bg-yellow-500/10 p-3 text-yellow-300 transition hover:bg-yellow-500/20"
                  aria-label="Toggle favorite"
                >
                  <Star className={`h-5 w-5 ${favorites.some((favorite) => favorite.from_currency === fromCurrency && favorite.to_currency === toCurrency) ? 'fill-current' : ''}`} />
                </button>
              </div>
            </div>

            {(convertedAmount || convertedAmount === 0) && (
              <div className="mt-6 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4">
                <p className="text-sm uppercase tracking-[0.2em] text-emerald-300">Converted Amount</p>
                <p className="mt-2 text-3xl font-bold text-white">
                  {amount} {fromCurrency} = {convertedAmount} {toCurrency}
                </p>
              </div>
            )}

            {error && (
              <div className="mt-6 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-red-300">
                {error}
              </div>
            )}
          </section>

          {travelMode && (
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-md shadow-slate-200/80">
              <div className="mb-4 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Travel Budgeting</p>
                  <h2 className="mt-2 text-2xl font-semibold text-slate-800">
                    Compare your budget in 5 major currencies
                  </h2>
                </div>
                <div className="rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-sm text-cyan-700">
                  Base: {fromCurrency}
                </div>
              </div>

              {travelLoading ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-slate-500">
                  Loading budget comparison...
                </div>
              ) : travelBudget.length ? (
                <div className="overflow-x-auto">
                  <table className="min-w-full border-separate border-spacing-y-2">
                    <thead>
                      <tr className="text-left text-sm text-slate-500">
                        <th className="px-3 py-2 font-medium">Currency</th>
                        <th className="px-3 py-2 font-medium">Rate</th>
                        <th className="px-3 py-2 font-medium">Equivalent Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {travelBudget.map((item) => (
                        <tr key={item.currency} className="rounded-xl bg-slate-50">
                          <td className="rounded-l-xl px-3 py-3 font-medium text-slate-800">{item.currency}</td>
                          <td className="px-3 py-3 text-slate-600">{item.rate ? item.rate.toFixed(4) : 'N/A'}</td>
                          <td className="rounded-r-xl px-3 py-3 text-slate-800">
                            {item.equivalent !== null ? `${item.equivalent.toFixed(2)}` : 'N/A'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-slate-500">
                  No travel comparison available yet.
                </div>
              )}
            </section>
          )}

          <section className="grid gap-6 xl:grid-cols-[1.5fr_0.9fr]">
            <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6">
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <p className="text-sm uppercase tracking-[0.2em] text-slate-400">Trend Analysis</p>
                  <h2 className="mt-2 text-2xl font-semibold">{fromCurrency} to {toCurrency}</h2>
                </div>
                <div className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-sm text-cyan-300">
                  {trendSummary.change}% over 30 days
                </div>
              </div>

              <div className="mb-6 grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
                  <p className="text-sm text-slate-400">Current Rate</p>
                  <p className="mt-2 text-2xl font-bold text-white">{trendSummary.current}</p>
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
                  <p className="text-sm text-slate-400">30-Day Change</p>
                  <p className={`mt-2 text-2xl font-bold ${Number(trendSummary.change) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {trendSummary.change}%
                  </p>
                </div>
              </div>

              {historicalData.length ? (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={historicalData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis dataKey="date" stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 12 }} />
                      <YAxis stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 12 }} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#020617',
                          border: '1px solid #334155',
                          borderRadius: '12px'
                        }}
                      />
                      <Line type="monotone" dataKey="rate" stroke="#22d3ee" strokeWidth={3} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="flex h-72 items-center justify-center rounded-2xl border border-dashed border-slate-700 text-slate-400">
                  Loading historical trend...
                </div>
              )}
            </div>

            <aside className="space-y-6">
              <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-xl font-semibold">Favorites</h3>
                  <Star className="h-5 w-5 text-yellow-300" />
                </div>

                <div className="space-y-3">
                  {favoritePairs.map((pair, index) => (
                    <button
                      key={`${pair.from_currency}-${pair.to_currency}-${index}`}
                      onClick={() => {
                        setFromCurrency(pair.from_currency);
                        setToCurrency(pair.to_currency);
                      }}
                      className="flex w-full items-center justify-between rounded-2xl border border-slate-700 bg-slate-950 p-3 text-left transition hover:border-cyan-400 hover:bg-slate-800"
                    >
                      <div>
                        <p className="text-sm text-slate-400">Pair</p>
                        <p className="font-medium text-white">
                          {pair.from_currency} → {pair.to_currency}
                        </p>
                      </div>
                      <TrendingUp className="h-4 w-4 text-cyan-400" />
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-xl font-semibold">Recent History</h3>
                  <History className="h-5 w-5 text-cyan-400" />
                </div>

                <div className="space-y-3">
                  {history.length ? (
                    history.map((item, index) => (
                      <div key={`${item.created_at}-${index}`} className="rounded-2xl border border-slate-700 bg-slate-950 p-3">
                        <p className="text-xs text-slate-400">
                          {new Date(item.created_at).toLocaleString()}
                        </p>
                        <p className="mt-1 font-medium text-white">
                          {item.amount} {item.from_currency} → {item.result.toFixed(2)} {item.to_currency}
                        </p>
                      </div>
                    ))
                  ) : (
                    <p className="text-slate-400">No recent conversions yet.</p>
                  )}
                </div>
              </div>
            </aside>
          </section>
        </main>
      </div>
    </div>
  );
}

export default App;
