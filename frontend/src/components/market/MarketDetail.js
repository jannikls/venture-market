import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Box, Typography, Paper, CircularProgress, TextField, Button, Divider } from '@mui/material';
import { getMarketDetail, getMarketBidAsk, placeMarketOrder, getMarketAMMState } from '../../utils/api';
import { Line } from 'react-chartjs-2';
import { makeLogBuckets, lmsrPrices, lmsrTrade, bayesianEvidenceTrade } from '../../utils/lmsr';
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
  const [orderBook, setOrderBook] = useState([]); // { price, size, side }
  const [trades, setTrades] = useState([]); // { price, size, side, user, time }
  
  // Trading UI state
  const [tradeSize, setTradeSize] = useState(0);
  const [tradeSide, setTradeSide] = useState('buy');
  const [orderType, setOrderType] = useState('market');
  const [limitPrice, setLimitPrice] = useState('');
  const [selectedBucket, setSelectedBucket] = useState(null);
  const [tradeResult, setTradeResult] = useState(null);
  const [bidAsk, setBidAsk] = useState([]);
  
  // Debug: Log bidAsk changes (debounced)
  useEffect(() => {
    if (bidAsk.length === 0) return;
    
    const timeoutId = setTimeout(() => {
      console.log('Bid/Ask updated:', bidAsk);
    }, 100);
    
    return () => clearTimeout(timeoutId);
  }, [bidAsk]);

  // Bayesian update UI state
  const [bayesConf, setBayesConf] = useState(0.95);
  const [bayesThresh, setBayesThresh] = useState(40000000);
  const [bayesBoost, setBayesBoost] = useState(3);
  
  // Debug: Log component renders
  console.count('MarketDetail render');

  // Memoize LMSR prices calculation
  const prices = React.useMemo(() => {
    console.log('Recalculating prices');
    if (!q?.length || !b) return [];
    return lmsrPrices(q, b);
  }, [q, b]);
  
  // Memoize bid/ask rows to prevent recalculation on every render
  const bidAskRows = React.useMemo(() => {
    if (!prices?.length || !buckets?.length) return [];
    
    const N = prices.length;
    const rows = [];
    const C = (qvec) => {
      const maxQ = Math.max(...qvec);
      const sumExp = qvec.reduce((sum, qk) => sum + Math.exp((qk - maxQ) / b), 0);
      return b * (Math.log(sumExp) + maxQ / b);
    };
    const probs = prices;
    for (let k = 0; k < N; ++k) {
      const e_k = new Array(N).fill(0);
      e_k[k] = 1;
      const ask = C(q.map((qk, i) => qk + e_k[i])) - C(q);
      const bid = C(q) - C(q.map((qk, i) => qk - e_k[i]));
      rows.push({
        bucket: buckets[k],
        bid: bid,
        mid: probs[k],
        ask: ask,
        liquidity: b * Math.log(buckets.length) // b * ln(N)
      });
    }
    return rows;
  }, [prices, buckets, b]);
  
  // Memoize market data to prevent unnecessary re-fetches
  const marketId = id; // Simple value for dependency array

  // Debug: Log component state changes (debounced to reduce noise)
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      console.log('Component state changed:', {
        loading,
        error: !!error,
        buckets: buckets?.length,
        q: q?.length,
        prices: prices?.length,
        bidAskRows: bidAskRows?.length,
        market: !!market
      });
    }, 100);
    
    return () => clearTimeout(timeoutId);
  }, [loading, error, buckets?.length, q?.length, prices?.length, bidAskRows?.length, market]);
  
  // Debug: Log market ID changes
  useEffect(() => {
    console.log('Market ID changed:', marketId);
  }, [marketId]);

  // Handler for Bayesian evidence update
  async function handleBayesianUpdate() {
    if (!q.length || !buckets.length) return;
    const currPrices = lmsrPrices(q, b);
    const total = currPrices.reduce((a, b) => a + b, 0);
    const p = total > 0 ? currPrices.map(x => x / total) : currPrices;
    // p_yes: boost all buckets above threshold using backend boost factor (1.5–2x)
    let p_yes = buckets.map((bk, i) => (bk.low >= bayesThresh ? p[i] * bayesBoost : p[i]));
    const sum_yes = p_yes.reduce((a, b) => a + b, 0);
    p_yes = p_yes.map(x => x / (sum_yes || 1));
    const p_no = p;
    // Compute delta_q (use boost factor from UI)
    const delta_q = bayesianEvidenceTrade(p, p_yes, p_no, bayesConf, b, bayesBoost);
    // Apply trade
    const { qAfter } = lmsrTrade(q, delta_q, b);
    setQ(qAfter);
    setOrderBook(prev => [
      ...prev,
      {
        price: null,
        size: delta_q.map(Math.abs).reduce((a, b) => a + b, 0).toFixed(2),
        side: `bayes (${bayesConf})`,
      },
    ]);
    setTrades(prev => [
      ...prev,
      {
        price: null,
        size: delta_q.map(Math.abs).reduce((a, b) => a + b, 0).toFixed(2),
        side: `bayes (${bayesConf})`,
        user: 'demo',
        time: new Date().toLocaleTimeString(),
      },
    ]);
  }

  useEffect(() => {
    let isMounted = true;
    
    async function fetchMarket() {
      if (!id) return;
      console.log('Starting to fetch market details for ID:', id);
      if (isMounted) setLoading(true);
      
      try {
        console.log('Fetching market data...');
        // Fetch market details
        const data = await getMarketDetail(id);
        console.log('Market data:', data);
        setMarket(data);
        
        // Setup buckets and q vector
        const min = data.outcome_min || 10_000_000;
        const max = data.outcome_max || 1_000_000_000_000;
        console.log('Creating buckets with min:', min, 'max:', max);
        const bks = makeLogBuckets(min, max);
        console.log('Generated buckets:', bks);
        setBuckets(bks);
        
        // Fetch backend AMM state (q, b)
        console.log('Fetching AMM state...');
        let amm;
        try {
          amm = await getMarketAMMState(id);
          console.log('AMM state response:', amm);
        } catch (e) {
          console.error('Error fetching AMM state:', e);
          setError('Failed to load AMM state: ' + (e.message || 'Unknown error'));
          setLoading(false);
          return;
        }
        
        if (!amm || !Array.isArray(amm.q) || typeof amm.b !== 'number') {
          console.error('Invalid AMM state format:', amm);
          setError('Invalid AMM state from backend');
          setLoading(false);
          return;
        }
        
        console.log('Setting AMM state - q:', amm.q, 'b:', amm.b);
        setQ(amm.q);
        setB(amm.b);
        
        // Fetch bid/ask prices
        console.log('Fetching bid/ask...');
        try {
          const ba = await getMarketBidAsk(id);
          console.log('Bid/Ask response:', ba);
          setBidAsk(ba);
        } catch (e) {
          console.error('Error fetching bid/ask:', e);
          setBidAsk([]);
        }
      } catch (err) {
        console.error('Error fetching market:', err);
        if (isMounted) {
          setError('Failed to load market details');
          setLoading(false);
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    
    fetchMarket();
    
    // Cleanup function to prevent state updates after unmount
    return () => {
      isMounted = false;
    };
  }, [marketId, market]); // Only depend on marketId and market

  // Remove duplicate prices calculation (moved above)

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



  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', mt: 6 }}><CircularProgress /></Box>;
  if (error) return <Box sx={{ maxWidth: 600, mx: 'auto', mt: 4 }}><Paper sx={{ p: 3 }}><Typography color="error">{error}</Typography></Paper></Box>;
  if (!market || !buckets.length || !prices.length) return null;

  const distributionData = getDistributionData();

  return (
    <Box sx={{ maxWidth: 900, mx: 'auto', mt: 4 }}>
      <Paper sx={{ p: 3 }}>
        <Typography variant="h5" gutterBottom>{market.title}</Typography>
        <Typography variant="body1" gutterBottom>{market.description}</Typography>
        <Divider sx={{ my: 2 }} />
        {/* User-facing documentation */}
        <Box sx={{ mb: 2, background: '#f8f9fa', borderRadius: 2, p: 2 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>How to Use This Market</Typography>
          <ul style={{ marginTop: 4, marginBottom: 4 }}>
            <li>Select a <b>valuation bucket</b> from the dropdown. Each bucket represents a possible outcome range for the venture's value.</li>
            <li>Choose <b>Buy (Ask)</b> if you want to bet the outcome will land in that bucket, or <b>Sell (Bid)</b> if you want to bet against it.</li>
            <li>Enter the <b>Size</b> (number of shares/contracts you want to buy or sell).</li>
            <li>Review the <b>Bid, Mid, Ask</b> prices for each bucket. These are calculated live from the market's automated market maker (AMM) and reflect current supply/demand.</li>
            <li>Click <b>Submit</b> to place your order. The system will show your fill price and update the order book and chart in real time.</li>
            <li>The <b>Liquidity</b> number shows the total capital backing the market. More liquidity means tighter spreads and deeper markets.</li>
          </ul>
          <Typography variant="body2" color="text.secondary">
            <b>Tip:</b> You can use the Bayesian update section below to simulate the impact of new information on the market's probability distribution.
          </Typography>
        </Box>
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
        <Typography variant="subtitle1">Place Order</Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 1 }}>
          <TextField
            select
            label="Bucket (Valuation)"
            value={selectedBucket ?? ''}
            onChange={e => setSelectedBucket(Number(e.target.value))}
            size="small"
            sx={{ width: 180 }}
          >
            <option value="" disabled>Select valuation</option>
            {bidAsk.map((row, i) => (
              <option key={i} value={i}>
                ${row.value && row.value.toLocaleString()} (Bid: {(row.bid*100).toFixed(2)}%, Ask: {(row.ask*100).toFixed(2)}%)
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
            disabled={selectedBucket === null}
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
            <option value="buy">Buy (Ask)</option>
            <option value="sell">Sell (Bid)</option>
          </TextField>
          <TextField
            select
            label="Order Type"
            value={orderType}
            onChange={e => setOrderType(e.target.value)}
            SelectProps={{ native: true }}
            size="small"
            sx={{ width: 120 }}
          >
            <option value="market">Market</option>
            <option value="limit">Limit</option>
          </TextField>
          {orderType === 'limit' && (
            <TextField
              label="Limit Price (%)"
              type="number"
              value={limitPrice}
              onChange={e => setLimitPrice(e.target.value)}
              size="small"
              sx={{ width: 120 }}
            />
          )}
          <Button
            variant="contained"
            color="success"
            onClick={async () => {
              if (selectedBucket === null || !tradeSize || tradeSize <= 0) return;
              try {
                const res = await placeMarketOrder(
                  id,
                  selectedBucket,
                  tradeSide,
                  Number(tradeSize),
                  orderType,
                  orderType === 'limit' ? Number(limitPrice)/100 : null
                );
                setTradeResult(res);
                // Refresh bid/ask after trade
                const ba = await getMarketBidAsk(id);
                setBidAsk(ba);
              } catch (e) {
                setTradeResult({ status: 'error', detail: e.message });
              }
            }}
            disabled={selectedBucket === null || !tradeSize || tradeSize <= 0 || (orderType === 'limit' && !limitPrice)}
          >
            Submit
          </Button>
        </Box>
        {tradeResult && (
          <Box sx={{ mt: 1 }}>
            <Typography variant="body2" color={tradeResult.status === 'error' ? 'error' : 'primary'}>
              {tradeResult.status === 'filled' && `Order filled: ${tradeResult.filled} @ ${(tradeResult.avg_price*100).toFixed(2)}%`}
              {tradeResult.status === 'partial' && `Partially filled: ${tradeResult.filled} @ ${(tradeResult.avg_price*100).toFixed(2)}%, ${tradeResult.remaining} unfilled`}
              {tradeResult.status === 'error' && `Order error: ${tradeResult.detail}`}
            </Typography>
          </Box>
        )}

        <Divider sx={{ my: 2 }} />
        {/* Bid/Ask Table */}
        <Typography variant="subtitle2" sx={{ mt: 2 }}>Order Book (AMM Bid/Ask)</Typography>
        <Box sx={{ maxHeight: 200, overflow: 'auto', my: 1 }}>
          <table style={{ width: '100%', fontSize: 13 }}>
            <thead>
              <tr>
                <th>Valuation</th>
                <th>Bid</th>
                <th>Mid</th>
                <th>Ask</th>
              </tr>
            </thead>
            <tbody>
              {bidAskRows.map((row, i) => (
                <tr key={i}>
                  <td>${row.value && row.value.toLocaleString()}</td>
                  <td style={{ color: 'green' }}>{(row.bid*100).toFixed(2)}%</td>
                  <td>{(row.mid*100).toFixed(2)}%</td>
                  <td style={{ color: 'red' }}>{(row.ask*100).toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Box>
        <Typography variant="body2" color="text.secondary">
          Liquidity (from API): <b>{market.liquidity || 'N/A'}</b> | Traders: <b>{market.traders || 'N/A'}</b>
        </Typography>
      </Paper>
      <Box sx={{ mt: 2 }}>
        <Typography variant="body2">
          Liquidity (worst-case AMM loss): <b>${(b * Math.log(q.length || 1)).toLocaleString(undefined, {maximumFractionDigits:2})}</b>
        </Typography>
      </Box>
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
