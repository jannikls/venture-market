import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Box, Typography, Paper, CircularProgress, TextField, Button, Divider } from '@mui/material';
import { getMarketDetail } from '../../utils/api';
import { Line } from 'react-chartjs-2';
import { makeBuckets, lmsrPrices, lmsrTrade, bayesianEvidenceTrade } from '../../utils/lmsr';
import OrderBookAndTrades from './OrderBookAndTrades';

function MarketDetail() {
  const { id } = useParams();
  const [market, setMarket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // LMSR AMM state
  const [buckets, setBuckets] = useState([]);
  const [q, setQ] = useState([]); // outstanding shares in each bucket
  const [b, setB] = useState(3000); // liquidity parameter (adjust as needed)
  const [orderBook, setOrderBook] = useState([]); // { price, bucket, size, side }
  const [trades, setTrades] = useState([]); // { price, bucket, size, side, user, time }

  // Trading UI state
  const [tradeBucket, setTradeBucket] = useState(0);
  const [tradeSize, setTradeSize] = useState(0);
  const [tradeSide, setTradeSide] = useState('buy');
  const [tradeQuote, setTradeQuote] = useState(null);

  // Bayesian update UI state
  const [bayesConf, setBayesConf] = useState(0.95);
  const [bayesThresh, setBayesThresh] = useState(40000000);
  const [bayesBoost, setBayesBoost] = useState(3);

  // Handler for Bayesian evidence update
  function handleBayesianUpdate() {
    if (!q.length || !buckets.length) return;
    // Compute current normalized probs
    const currPrices = lmsrPrices(q, b);
    const total = currPrices.reduce((a, b) => a + b, 0);
    const p = total > 0 ? currPrices.map(x => x / total) : currPrices;
    // p_yes: boost all buckets above threshold
    let p_yes = buckets.map((bk, i) => (bk.low >= bayesThresh ? p[i] * bayesBoost : p[i]));
    const sum_yes = p_yes.reduce((a, b) => a + b, 0);
    p_yes = p_yes.map(x => x / (sum_yes || 1));
    // p_no: just use p
    const p_no = p;
    // Compute delta_q
    const delta_q = bayesianEvidenceTrade(p, p_yes, p_no, bayesConf, b);
    // Apply trade
    const { payment, qAfter } = lmsrTrade(q, delta_q, b);
    setQ(qAfter);
    setOrderBook(prev => [
      ...prev,
      {
        price: null,
        bucket: null,
        size: delta_q.map(Math.abs).reduce((a, b) => a + b, 0).toFixed(2),
        side: `bayes (${bayesConf})`,
      },
    ]);
    setTrades(prev => [
      ...prev,
      {
        price: null,
        bucket: null,
        size: delta_q.map(Math.abs).reduce((a, b) => a + b, 0).toFixed(2),
        side: `bayes (${bayesConf})`,
        user: 'demo',
        time: new Date().toLocaleTimeString(),
      },
    ]);
  }

  useEffect(() => {
    async function fetchMarket() {
      try {
        setLoading(true);
        const data = await getMarketDetail(id);
        setMarket(data);
        setError('');
        // Setup buckets and q vector
        const min = data.outcome_min || 10_000_000;
        const max = data.outcome_max || 100_000_000;
        const bks = makeBuckets(min, max); // Uses fixed $5M increments by default
        setBuckets(bks);
        // Initialize LMSR with log-normal prior (median at midpoint, sigma=0.5)
        try {
          const { priorLogNormal } = await import('../../utils/lmsr');
          const median = (bks[0].center + bks[bks.length-1].center) / 2;
          const prior = priorLogNormal(bks, median, 0.5);
          // q0 = b * log(p_i) so that prices = prior
          setQ(prior.map(p => Math.log(p + 1e-12) * b));
        } catch (e) {
          setQ(new Array(bks.length).fill(0));
        }
      } catch (err) {
        setError('Failed to load market details');
      } finally {
        setLoading(false);
      }
    }
    fetchMarket();
  }, [id]);

  // Calculate LMSR prices
  const prices = (q.length && b) ? lmsrPrices(q, b) : [];

  // Chart data: show rounded bucket edges, normalized probabilities as %
  function getDistributionData() {
    if (!buckets.length || !prices.length) return { labels: [], datasets: [] };
    // Normalize prices so sum = 1
    const total = prices.reduce((a, b) => a + b, 0);
    const norm = total > 0 ? prices.map(p => p / total) : prices;
    return {
      labels: buckets.map(bk => `${bk.low/1e6}M-${bk.high/1e6}M`),
      datasets: [
        {
          label: 'Probability Distribution',
          data: norm.map(p => p * 100), // as %
          fill: true,
          borderColor: 'blue',
          backgroundColor: 'rgba(30, 144, 255, 0.2)',
          pointRadius: 2,
          showLine: true,
        },
      ],
    };
  }

  // Simulate a trade and quote the cost
  function quoteTrade(bucketIdx, size, side) {
    if (!q.length) return null;
    const delta = new Array(q.length).fill(0);
    delta[bucketIdx] = (side === 'buy' ? 1 : -1) * Number(size);
    const { payment } = lmsrTrade(q, delta, b);
    return payment;
  }

  // Execute a trade (update q, order book, trades)
  function executeTrade() {
    if (!q.length || !tradeSize || tradeSize <= 0) return;
    const delta = new Array(q.length).fill(0);
    delta[tradeBucket] = (tradeSide === 'buy' ? 1 : -1) * Number(tradeSize);
    const { payment, qAfter } = lmsrTrade(q, delta, b);
    setQ(qAfter);
    setOrderBook(prev => [
      ...prev,
      {
        price: prices[tradeBucket],
        bucket: tradeBucket,
        size: tradeSize,
        side: tradeSide,
      },
    ]);
    setTrades(prev => [
      ...prev,
      {
        price: prices[tradeBucket],
        bucket: tradeBucket,
        size: tradeSize,
        side: tradeSide,
        user: 'demo',
        time: new Date().toLocaleTimeString(),
      },
    ]);
    setTradeQuote(payment);
  }

  if (loading) return <CircularProgress />;
  if (error) return <Typography color="error">{error}</Typography>;
  if (!market || !buckets.length || !prices.length) return null;

  const distributionData = getDistributionData();

  return (
    <Box sx={{ maxWidth: 900, mx: 'auto', mt: 4 }}>
      <Paper sx={{ p: 3 }}>
        <Typography variant="h5" gutterBottom>{market.title}</Typography>
        <Typography variant="body1" gutterBottom>{market.description}</Typography>
        <Divider sx={{ my: 2 }} />
        <Typography variant="subtitle1">Probability Distribution (LMSR Live)</Typography>
        <Box sx={{ height: 300 }}>
          <Line data={distributionData} options={{
            responsive: true,
            plugins: { legend: { display: false } },
            scales: {
              x: { title: { display: true, text: 'Valuation (USD, log buckets)' } },
              y: { title: { display: true, text: 'Probability' } },
            },
          }} />
        </Box>
        <Divider sx={{ my: 2 }} />
        <Typography variant="subtitle1">Trade (AMM, instant fill)</Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 1 }}>
          <TextField
            select
            label="Bucket"
            value={tradeBucket}
            onChange={e => setTradeBucket(Number(e.target.value))}
            SelectProps={{ native: true }}
            size="small"
          >
            {buckets.map((bk, i) => (
              <option key={i} value={i}>
                {bk.low.toLocaleString()} - {bk.high.toLocaleString()}
              </option>
            ))}
          </TextField>
          <TextField
            label="Size"
            type="number"
            value={tradeSize}
            onChange={e => setTradeSize(e.target.value)}
            size="small"
            sx={{ width: 100 }}
          />
          <TextField
            select
            label="Side"
            value={tradeSide}
            onChange={e => setTradeSide(e.target.value)}
            SelectProps={{ native: true }}
            size="small"
            sx={{ width: 100 }}
          >
            <option value="buy">Buy</option>
            <option value="sell">Sell</option>
          </TextField>
          <Button
            variant="contained"
            onClick={() => {
              setTradeQuote(quoteTrade(tradeBucket, tradeSize, tradeSide));
            }}
            disabled={!tradeSize || tradeSize <= 0}
          >
            Quote
          </Button>
          <Button
            variant="contained"
            color="success"
            onClick={executeTrade}
            disabled={!tradeSize || tradeSize <= 0}
          >
            Execute
          </Button>
        </Box>
        {tradeQuote !== null && (
          <Typography sx={{ mt: 1 }}>Trade cost (AMM): <b>${tradeQuote.toFixed(4)}</b></Typography>
        )}
        <Divider sx={{ my: 2 }} />
        <Typography variant="body2" color="text.secondary">
          Liquidity (from API): <b>{market.liquidity || 'N/A'}</b> | Traders: <b>{market.traders || 'N/A'}</b>
        </Typography>
      </Paper>
      <Divider sx={{ my: 2 }} />
      {/* --- Bayesian Evidence Update Section --- */}
      <Typography variant="subtitle1" sx={{ mt: 2 }}>Bayesian Evidence Update</Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 1 }}>
        <TextField
          label="Confidence (0-1)"
          type="number"
          inputProps={{ min: 0, max: 1, step: 0.01 }}
          value={bayesConf}
          onChange={e => setBayesConf(Number(e.target.value))}
          size="small"
          sx={{ width: 120 }}
        />
        <TextField
          label="Threshold ($)"
          type="number"
          value={bayesThresh}
          onChange={e => setBayesThresh(Number(e.target.value))}
          size="small"
          sx={{ width: 150 }}
        />
        <TextField
          label="Boost Factor (>1)"
          type="number"
          value={bayesBoost}
          onChange={e => setBayesBoost(Number(e.target.value))}
          size="small"
          sx={{ width: 120 }}
        />
        <Button
          variant="contained"
          color="secondary"
          onClick={handleBayesianUpdate}
          disabled={bayesConf <= 0 || bayesConf > 1 || !bayesThresh || bayesBoost <= 1}
        >
          Bayesian Update
        </Button>
      </Box>
      <Typography variant="body2" sx={{ mt: 1 }}>
        Example: "I have 95% confidence a round was raised at $40M+" → Confidence: 0.95, Threshold: 40000000, Boost: 3
      </Typography>
      <OrderBookAndTrades orderBook={orderBook} trades={trades} buckets={buckets} />
    </Box>
  );
}

export default MarketDetail;
