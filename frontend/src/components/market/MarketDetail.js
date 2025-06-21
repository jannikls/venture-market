import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { 
  Box, Typography, Paper, CircularProgress, TextField, Button, Divider, 
  Select, MenuItem, FormControl, InputLabel, Alert, Tabs, Tab, Switch,
  FormControlLabel, Grid, Card, CardContent, Chip
} from '@mui/material';
import { getMarketDetail, getMarketBidAsk, placeMarketOrder, getMarketAMMState, quoteAndTrade } from '../../utils/api';
import { Line, Bar } from 'react-chartjs-2';
import { 
  makeLogBuckets, 
  lmsrPrices, 
  lmsrTrade, 
  bayesianEvidenceTrade, 
  formatCurrency, 
  getBucketDescription, 
  findOrCreateBucket 
} from '../../utils/lmsr';

// Utility function for debouncing
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Advanced Mathematical Functions
const normalCDF = (x) => {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  let prob = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - prob : prob;
};

const normalPDF = (x) => {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
};

const blackScholes = (S, K, T, r, sigma, type = 'call') => {
  if (T <= 0) return type === 'call' ? Math.max(S - K, 0) : Math.max(K - S, 0);
  
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  
  if (type === 'call') {
    return S * normalCDF(d1) - K * Math.exp(-r * T) * normalCDF(d2);
  } else {
    return K * Math.exp(-r * T) * normalCDF(-d2) - S * normalCDF(-d1);
  }
};

const calculateGreeks = (S, K, T, r, sigma) => {
  if (T <= 0) return { delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 };
  
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  
  return {
    delta: normalCDF(d1),
    gamma: normalPDF(d1) / (S * sigma * Math.sqrt(T)),
    theta: -(S * normalPDF(d1) * sigma) / (2 * Math.sqrt(T)) - r * K * Math.exp(-r * T) * normalCDF(d2),
    vega: S * normalPDF(d1) * Math.sqrt(T),
    rho: K * T * Math.exp(-r * T) * normalCDF(d2)
  };
};

// Startup-specific probability initialization
function createRealisticStartupBreakpoints(minVal = 1e6, maxVal = 500e9) {
  // Create logarithmic breakpoints that make sense for startups
  const breakpoints = [];
  
  // Early stage: $1M - $100M (more granular)
  for (let val = 1e6; val <= 100e6; val *= 2) {
    breakpoints.push(val);
  }
  
  // Growth stage: $100M - $10B (moderate granularity)
  for (let val = 200e6; val <= 10e9; val *= 1.5) {
    breakpoints.push(val);
  }
  
  // Mega scale: $10B - $500B (coarser granularity)
  for (let val = 15e9; val <= maxVal; val *= 2) {
    breakpoints.push(val);
  }
  
  // Remove duplicates and sort
  const uniqueBreakpoints = [...new Set(breakpoints)].sort((a, b) => a - b);
  return uniqueBreakpoints;
}

function createRealisticStartupProbabilities(breakpoints, currentValuation = 50e6, stage = 'growth') {
  const buckets = breakpointsToBuckets(breakpoints);
  const probabilities = new Array(buckets.length).fill(0);
  
  // Stage-based probability distributions
  const stageProfiles = {
    seed: { mean: 10e6, stdDev: 5e6, skew: 2 },
    seriesA: { mean: 25e6, stdDev: 15e6, skew: 1.5 },
    growth: { mean: 200e6, stdDev: 150e6, skew: 1.2 },
    late: { mean: 1e9, stdDev: 500e6, skew: 1 },
    mega: { mean: 10e9, stdDev: 5e9, skew: 0.8 }
  };
  
  const profile = stageProfiles[stage] || stageProfiles.growth;
  
  // Use log-normal distribution centered around current valuation
  const logMean = Math.log(currentValuation);
  const logStdDev = 0.8; // High uncertainty is realistic for startups
  
  buckets.forEach((bucket, i) => {
    const bucketMid = (bucket.low + bucket.high) / 2;
    const logBucketMid = Math.log(bucketMid);
    
    // Log-normal probability density
    const exponent = -Math.pow(logBucketMid - logMean, 2) / (2 * Math.pow(logStdDev, 2));
    let prob = Math.exp(exponent) / (bucketMid * logStdDev * Math.sqrt(2 * Math.PI));
    
    // Add startup-specific adjustments
    if (bucketMid < currentValuation * 0.5) {
      prob *= 0.3; // Lower probability of significant down-rounds
    } else if (bucketMid > currentValuation * 3) {
      prob *= 1.5; // Higher probability of good outcomes (survivor bias)
    }
    
    // Failure scenario (very low valuations)
    if (bucketMid < currentValuation * 0.1) {
      prob += 0.05; // 5% base probability of significant failure
    }
    
    probabilities[i] = prob;
  });
  
  // Normalize probabilities
  const total = probabilities.reduce((sum, p) => sum + p, 0);
  return probabilities.map(p => p / total);
}

function createStartupQLMSR(probabilities, b = 3000) {
  // Convert probabilities to LMSR q values
  const q = probabilities.map(p => b * Math.log(Math.max(p, 1e-10)));
  return q;
}

function breakpointsToBuckets(breakpoints) {
  const buckets = [];
  for (let i = 0; i < breakpoints.length - 1; i++) {
    buckets.push({
      idx: i,
      low: breakpoints[i],
      high: breakpoints[i + 1],
      mid: (breakpoints[i] + breakpoints[i + 1]) / 2,
      x: breakpoints[i]
    });
  }
  return buckets;
}

function splitInterval(breakpoints, q, b, targetValue) {
  let intervalIdx = -1;
  for (let i = 0; i < breakpoints.length - 1; i++) {
    if (targetValue >= breakpoints[i] && targetValue < breakpoints[i + 1]) {
      intervalIdx = i;
      break;
    }
  }
  
  if (intervalIdx === -1 || breakpoints.includes(targetValue)) {
    return { breakpoints, q };
  }
  
  const x_i = breakpoints[intervalIdx];
  const x_i_plus_1 = breakpoints[intervalIdx + 1];
  const q_i = q[intervalIdx];
  
  const deltaX_old = x_i_plus_1 - x_i;
  const deltaX_low = targetValue - x_i;
  const deltaX_high = x_i_plus_1 - targetValue;
  
  const p_i = Math.exp(q_i / b);
  const p_low = p_i * (deltaX_low / deltaX_old);
  const p_high = p_i * (deltaX_high / deltaX_old);
  const q_low = b * Math.log(Math.max(p_low, 1e-10));
  const q_high = b * Math.log(Math.max(p_high, 1e-10));
  
  const newBreakpoints = [
    ...breakpoints.slice(0, intervalIdx + 1),
    targetValue,
    ...breakpoints.slice(intervalIdx + 1)
  ];
  
  const newQ = [
    ...q.slice(0, intervalIdx),
    q_low,
    q_high,
    ...q.slice(intervalIdx + 1)
  ];
  
  return { breakpoints: newBreakpoints, q: newQ };
}

// For venture betting: binary outcome contracts
function createSimpleContract(breakpoints, strike) {
  // Binary bet: valuation above strike = win, below = lose
  const deltaQ = new Array(breakpoints.length - 1).fill(0);
  
  for (let i = 0; i < breakpoints.length - 1; i++) {
    const intervalLow = breakpoints[i];
    const intervalHigh = breakpoints[i + 1];
    
    if (intervalLow >= strike) {
      deltaQ[i] = 1; // Full probability mass above strike
    } else if (intervalHigh > strike && intervalLow < strike) {
      // Proportional exposure for interval crossing strike
      const overlapRatio = (intervalHigh - strike) / (intervalHigh - intervalLow);
      deltaQ[i] = overlapRatio;
    }
  }
  
  return deltaQ;
}

function createShortContract(breakpoints, strike) {
  // Binary bet: valuation below strike = win, above = lose
  const deltaQ = new Array(breakpoints.length - 1).fill(0);
  for (let i = 0; i < breakpoints.length - 1; i++) {
    const intervalLow = breakpoints[i];
    const intervalHigh = breakpoints[i + 1];
    if (intervalHigh <= strike) {
      deltaQ[i] = 1; // Full probability mass below strike
    } else if (intervalHigh > strike && intervalLow < strike) {
      const overlapRatio = (strike - intervalLow) / (intervalHigh - intervalLow);
      deltaQ[i] = overlapRatio;
    }
  }
  return deltaQ;
}

// For options-style contracts (call/put payoffs)
function createCallContract(breakpoints, strike) {
  const deltaQ = new Array(breakpoints.length - 1).fill(0);
  
  for (let i = 0; i < breakpoints.length - 1; i++) {
    const intervalLow = breakpoints[i];
    const intervalHigh = breakpoints[i + 1];
    
    if (intervalLow >= strike) {
      deltaQ[i] = 1;
    } else if (intervalHigh > strike && intervalLow < strike) {
      const overlapRatio = (intervalHigh - strike) / (intervalHigh - intervalLow);
      deltaQ[i] = overlapRatio;
    }
  }
  
  return deltaQ;
}

function createPutContract(breakpoints, strike) {
  const deltaQ = new Array(breakpoints.length - 1).fill(0);
  
  for (let i = 0; i < breakpoints.length - 1; i++) {
    const intervalLow = breakpoints[i];
    const intervalHigh = breakpoints[i + 1];
    
    if (intervalHigh <= strike) {
      deltaQ[i] = 1;
    } else if (intervalLow < strike && intervalHigh > strike) {
      const overlapRatio = (strike - intervalLow) / (intervalHigh - intervalLow);
      deltaQ[i] = overlapRatio;
    }
  }
  
  return deltaQ;
}

function validateTrade(deltaQ, currentQ, b) {
  const newQ = currentQ.map((q, i) => q + deltaQ[i]);
  const newPrices = lmsrPrices(newQ, b);
  
  if (newPrices.some(p => p < 0)) {
    throw new Error("Trade would create negative probabilities");
  }
  
  const total = newPrices.reduce((a, b) => a + b, 0);
  if (Math.abs(total - 1) > 0.02) {
    throw new Error("Trade would break probability normalization");
  }
  
  return true;
}

function calculatePortfolioMetrics(positions, currentPrices) {
  let totalValue = 0;
  let totalDelta = 0;
  let totalGamma = 0;
  let totalTheta = 0;
  let totalVega = 0;
  
  positions.forEach(pos => {
    const price = currentPrices[pos.strike] || 0;
    totalValue += pos.quantity * price;
    
    if (pos.greeks) {
      totalDelta += pos.quantity * pos.greeks.delta;
      totalGamma += pos.quantity * pos.greeks.gamma;
      totalTheta += pos.quantity * pos.greeks.theta;
      totalVega += pos.quantity * pos.greeks.vega;
    }
  });
  
  return {
    totalValue,
    delta: totalDelta,
    gamma: totalGamma,
    theta: totalTheta,
    vega: totalVega
  };
}

// Main MarketDetail component
function MarketDetail() {
  const { id } = useParams();
  
  // Core state - Initialize all state variables properly
  const [market, setMarket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState(0);
  const [breakpoints, setBreakpoints] = useState([]);
  const [q, setQ] = useState([]);
  const [b, setB] = useState(3000);
  const [orderBook, setOrderBook] = useState([]);
  const [trades, setTrades] = useState([]);
  const [tradeSize, setTradeSize] = useState(1);
  const [tradeSide, setTradeSide] = useState('buy');
  const [tradingMode, setTradingMode] = useState('simple');
  const [optionType, setOptionType] = useState('call');
  const [optionStyle, setOptionStyle] = useState('european');
  const [orderType, setOrderType] = useState('market');
  const [limitPrice, setLimitPrice] = useState('');
  const [selectedBucket, setSelectedBucket] = useState(null);
  const [tradeResult, setTradeResult] = useState(null);
  const [bidAsk, setBidAsk] = useState([]);
  const [customValuation, setCustomValuation] = useState('');
  const [tradeDescription, setTradeDescription] = useState('');
  const [slippageTolerance, setSlippageTolerance] = useState(0.05);
  const [maxPosition, setMaxPosition] = useState(1000);
  const [userPositions, setUserPositions] = useState({});
  const [portfolio, setPortfolio] = useState([]);
  const [riskFreeRate, setRiskFreeRate] = useState(0.05);
  const [timeToExpiry, setTimeToExpiry] = useState(365);
  const [impliedVolatility, setImpliedVolatility] = useState(0.3);
  const [currentValuation, setCurrentValuation] = useState(50000000);
  const [bayesConf, setBayesConf] = useState(0.95);
  const [bayesThresh, setBayesThresh] = useState(40000000);
  const [bayesBoost, setBayesBoost] = useState(3);
  const [marketMakingEnabled, setMarketMakingEnabled] = useState(false);
  const [marketMakerSpread, setMarketMakerSpread] = useState(0.02);
  const [pendingOrders, setPendingOrders] = useState([]);
  const wsRef = useRef(null);

  // Handler functions with proper error handling
  const cancelOrder = useCallback((orderId) => {
    setPendingOrders(prev => prev.filter(order => order.id !== orderId));
  }, []);

  const closePosition = useCallback((positionId) => {
    setPortfolio(prev => prev.filter(pos => pos.id !== positionId));
  }, []);

  // Fetch market data with defensive error handling
  const fetchMarket = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // Fetch main market details
      const marketRes = await getMarketDetail(id);
      if (!marketRes || marketRes.error) throw new Error(marketRes?.error || 'Failed to load market');
      setMarket(marketRes);

      // Fetch AMM state
      const ammRes = await getMarketAMMState(id);
      if (!ammRes || ammRes.error) throw new Error(ammRes?.error || 'Failed to load AMM state');
      
      let breakpoints = ammRes.breakpoints || [];
      let q = ammRes.q || [];
      const b = ammRes.b || 3000;

      // Fix: Generate breakpoints if missing but q exists
      if ((!breakpoints || breakpoints.length === 0) && q && q.length > 0) {
        console.log('Generating missing breakpoints for q array length:', q.length);
        // Create realistic startup breakpoints
        breakpoints = createRealisticStartupBreakpoints(1e6, 500e9);
        
        // Ensure breakpoints.length = q.length + 1
        while (breakpoints.length !== q.length + 1) {
          if (breakpoints.length < q.length + 1) {
            // Add more breakpoints
            const lastVal = breakpoints[breakpoints.length - 1];
            breakpoints.push(lastVal * 1.5);
          } else {
            // Remove excess breakpoints
            breakpoints.pop();
          }
        }
        
        // If we have uniform q values, replace with realistic startup probabilities
        const qVariance = q.reduce((acc, val, i, arr) => {
          const mean = arr.reduce((sum, v) => sum + v, 0) / arr.length;
          return acc + Math.pow(val - mean, 2);
        }, 0) / q.length;
        
        if (qVariance < 1) { // Essentially uniform distribution
          console.log('Detected uniform distribution, initializing with realistic startup probabilities');
          const realisticProbs = createRealisticStartupProbabilities(breakpoints, currentValuation, 'growth');
          q = createStartupQLMSR(realisticProbs, b);
        }
      }

      // Additional validation and fallback
      if (q.length > 0 && breakpoints.length !== q.length + 1) {
        console.warn(`Breakpoints length (${breakpoints.length}) doesn't match q.length + 1 (${q.length + 1}). Fixing...`);
        // Generate proper startup breakpoints array
        breakpoints = createRealisticStartupBreakpoints(1e6, 500e9);
        
        // Adjust to match q length
        while (breakpoints.length !== q.length + 1) {
          if (breakpoints.length < q.length + 1) {
            const lastVal = breakpoints[breakpoints.length - 1];
            breakpoints.push(lastVal * 1.5);
          } else {
            breakpoints.pop();
          }
        }
        
        // Initialize with realistic probabilities if q is uniform
        const qMean = q.reduce((sum, v) => sum + v, 0) / q.length;
        const isUniform = q.every(v => Math.abs(v - qMean) < 0.1);
        
        if (isUniform) {
          const realisticProbs = createRealisticStartupProbabilities(breakpoints, currentValuation, 'growth');
          q = createStartupQLMSR(realisticProbs, b);
        }
      }

      setBreakpoints(breakpoints);
      setQ(q);
      setB(b);

      setLoading(false);
    } catch (err) {
      setError(err.message || 'Failed to load market');
      setLoading(false);
    }
  }, [id]);

  // Fetch on mount
  useEffect(() => {
    if (id) fetchMarket();
  }, [id, fetchMarket]);

  // Memoized calculations with proper array guards
  const prices = React.useMemo(() => {
    if (!Array.isArray(q) || q.length === 0 || !b) return [];
    return lmsrPrices(q, b);
  }, [q, b]);

  const lambda = 0.8;
  const prevMidsRef = useRef([]);

  const bidAskRows = React.useMemo(() => {
    if (!Array.isArray(prices) || prices.length === 0) return [];
    
    let workingBreakpoints = breakpoints;
    
    // Generate breakpoints if missing but we have q and prices
    if ((!Array.isArray(breakpoints) || breakpoints.length === 0) && Array.isArray(q) && q.length > 0) {
      console.log('Generating breakpoints in bidAskRows calculation');
      workingBreakpoints = createRealisticStartupBreakpoints(1e6, 500e9);
      
      // Adjust to match q length
      while (workingBreakpoints.length !== q.length + 1) {
        if (workingBreakpoints.length < q.length + 1) {
          const lastVal = workingBreakpoints[workingBreakpoints.length - 1];
          workingBreakpoints.push(lastVal * 1.5);
        } else {
          workingBreakpoints.pop();
        }
      }
    }
    
    if (!Array.isArray(workingBreakpoints) || workingBreakpoints.length === 0) return [];
    
    const buckets = breakpointsToBuckets(workingBreakpoints);
    const N = prices.length;
    if (!Array.isArray(buckets) || buckets.length !== N) {
      console.warn(`Bucket count (${buckets.length}) doesn't match prices count (${N})`);
      return [];
    }
    const rows = [];
    let prevMids = prevMidsRef.current;
    if (prevMids.length !== N) prevMids = Array(N).fill(0);
    const newMids = [];

    const C = (qvec) => {
      if (!Array.isArray(qvec) || qvec.length === 0) return 0;
      const maxQ = Math.max(...qvec);
      const sumExp = qvec.reduce((sum, qk) => sum + Math.exp((qk - maxQ) / b), 0);
      return b * (Math.log(sumExp) + maxQ / b);
    };

    const probs = prices;
    for (let k = 0; k < N; ++k) {
      const e_k = new Array(N).fill(0);
      e_k[k] = 1;
      
      let ask = C(q.map((qk, i) => qk + e_k[i])) - C(q);
      let bid = C(q) - C(q.map((qk, i) => qk - e_k[i]));
      
      if (marketMakingEnabled) {
        const mid = (ask + bid) / 2;
        const spread = marketMakerSpread;
        ask = mid * (1 + spread/2);
        bid = mid * (1 - spread/2);
      }
      
      const smoothedMid = lambda * prevMids[k] + (1 - lambda) * probs[k];
      newMids.push(smoothedMid);
      
      const T = timeToExpiry / 365;
      const strike = buckets[k].low;
      const greeks = calculateGreeks(currentValuation, strike, T, riskFreeRate, impliedVolatility);
      
      rows.push({
        bucket: buckets[k],
        bid: Math.max(bid, 0.001),
        mid: smoothedMid,
        ask: Math.min(ask, 0.999),
        value: buckets[k].low,
        liquidity: b * Math.log(workingBreakpoints.length),
        greeks,
        blackScholesPrice: blackScholes(currentValuation, strike, T, riskFreeRate, impliedVolatility, optionType)
      });
    }
    prevMidsRef.current = newMids;
    return rows;
  }, [prices, breakpoints, b, q, lambda, marketMakingEnabled, marketMakerSpread, 
      currentValuation, timeToExpiry, riskFreeRate, impliedVolatility, optionType]);

  const getDistributionData = useCallback(() => {
    if (!Array.isArray(prices) || prices.length === 0) {
      return { labels: [], datasets: [] };
    }
    
    let workingBreakpoints = breakpoints;
    
    // Generate breakpoints if missing
    if ((!Array.isArray(breakpoints) || breakpoints.length === 0) && Array.isArray(q) && q.length > 0) {
      workingBreakpoints = createRealisticStartupBreakpoints(1e6, 500e9);
      
      // Adjust to match q length
      while (workingBreakpoints.length !== q.length + 1) {
        if (workingBreakpoints.length < q.length + 1) {
          const lastVal = workingBreakpoints[workingBreakpoints.length - 1];
          workingBreakpoints.push(lastVal * 1.5);
        } else {
          workingBreakpoints.pop();
        }
      }
    }
    
    if (!Array.isArray(workingBreakpoints) || workingBreakpoints.length === 0) {
      // Fallback: create simple labels based on price array indices
      const labels = prices.map((_, idx) => `Bucket ${idx + 1}`);
      const total = prices.reduce((a, b) => a + b, 0);
      const norm = total > 0 ? prices.map(p => p / total) : prices;
      
      return {
        labels,
        datasets: [
          {
            label: 'Probability Distribution',
            data: norm.map(p => p * 100),
            fill: true,
            borderColor: 'blue',
            backgroundColor: 'rgba(30, 144, 255, 0.2)',
            pointRadius: 2,
          },
        ],
      };
    }
    
    const buckets = breakpointsToBuckets(workingBreakpoints);
    const total = prices.reduce((a, b) => a + b, 0);
    const norm = total > 0 ? prices.map(p => p / total) : prices;
    
    return {
      labels: buckets.map(bk => `${(bk.low/1e6).toFixed(1)}M`),
      datasets: [
        {
          label: 'Probability Distribution',
          data: norm.map(p => p * 100),
          fill: true,
          borderColor: 'blue',
          backgroundColor: 'rgba(30, 144, 255, 0.2)',
          pointRadius: 2,
        },
      ],
    };
  }, [breakpoints, prices, q]);

  const portfolioMetrics = React.useMemo(() => {
    const currentPrices = {};
    (Array.isArray(bidAskRows) ? bidAskRows : []).forEach(row => {
      currentPrices[row.value] = row.mid;
    });
    return calculatePortfolioMetrics((Array.isArray(portfolio) ? portfolio : []), currentPrices);
  }, [portfolio, bidAskRows]);

  const distributionData = getDistributionData();

  // Handle valuation change with debouncing - Fixed to work properly
  const handleValuationChange = useCallback((e) => {
    const value = e.target.value;
    setCustomValuation(value);
    
    // Clear previous results
    setTradeResult(null);
    setSelectedBucket(null);
    setTradeDescription('');
    setBidAsk([]);
    
    if (!value) return;
    
    // Parse the input value
    const numValue = parseFloat(value.replace(/[^0-9.]/g, ''));
    if (isNaN(numValue)) return;
    
    const multiplier = value.toLowerCase().includes('b') ? 1e9 :
      value.toLowerCase().includes('m') ? 1e6 : 1;
    const valuation = Math.round(numValue * multiplier);

    if (Array.isArray(breakpoints) && Array.isArray(q) && b) {
      const { breakpoints: newBreakpoints, q: newQ } = splitInterval(breakpoints, q, b, valuation);
      setBreakpoints(newBreakpoints);
      setQ(newQ);
    }

    const selectedBucket = { x: valuation, low: valuation, high: Infinity };
    setSelectedBucket(selectedBucket);
    
    let description;
    if (tradingMode === 'simple') {
      description = tradeSide === 'buy' 
        ? `Binary bet: Pays $1 if final valuation ≥ ${formatCurrency(valuation)}, $0 otherwise`
        : `Binary bet: Pays $1 if final valuation ≤ ${formatCurrency(valuation)}, $0 otherwise`;
    } else {
      description = optionType === 'call' 
        ? `Call option: Pays max($0, FinalValue - ${formatCurrency(valuation)})`
        : `Put option: Pays max($0, ${formatCurrency(valuation)} - FinalValue)`;
    }
    setTradeDescription(description);

    try {
      setBidAsk([]);
      const basePrice = 0.5;
      const quote = {
        bid: basePrice * 0.95,
        ask: basePrice * 1.05,
        value: valuation
      };
      setBidAsk([quote]);
    } catch (err) {
      setBidAsk([]);
      setTradeResult({ success: false, message: err.message });
    }
  }, [breakpoints, q, b, tradingMode, tradeSide, optionType]);

  // Handle Bayesian update
  const handleBayesianUpdate = async () => {
    if (!Array.isArray(q) || q.length === 0 || !Array.isArray(breakpoints) || breakpoints.length === 0) return;
    const buckets = breakpointsToBuckets(breakpoints);
    const currPrices = lmsrPrices(q, b);
    const total = currPrices.reduce((a, b) => a + b, 0);
    const p = total > 0 ? currPrices.map(x => x / total) : currPrices;
    
    let p_yes = buckets.map((bk, i) => (bk.low >= bayesThresh ? p[i] * bayesBoost : p[i]));
    const sum_yes = p_yes.reduce((a, b) => a + b, 0);
    p_yes = p_yes.map(x => x / (sum_yes || 1));
    const p_no = p;
    
    const delta_q = bayesianEvidenceTrade(p, p_yes, p_no, bayesConf, b, bayesBoost);
    const { qAfter } = lmsrTrade(q, delta_q, b);
    setQ(qAfter);
    
    setOrderBook(prev => [...prev, {
      price: null,
      size: delta_q.map(Math.abs).reduce((a, b) => a + b, 0).toFixed(2),
      side: `bayes (${bayesConf})`,
      timestamp: new Date()
    }]);
  };

  // Handle trade execution with comprehensive error handling
  const handleTrade = async () => {
    if (!selectedBucket || !tradeSize) {
      setTradeResult({
        success: false,
        message: 'Please enter a target valuation and trade size',
      });
      return;
    }

    try {
      const currentPosition = userPositions[selectedBucket.x] || 0;
      const newPosition = currentPosition + (tradeSide === 'buy' ? tradeSize : -tradeSize);
      
      if (Math.abs(newPosition) > maxPosition) {
        throw new Error(`Position limit exceeded. Max: ${maxPosition}`);
      }

      let deltaQ;
      if (tradingMode === 'simple') {
        if (tradeSide === 'buy') {
          deltaQ = createSimpleContract(breakpoints, selectedBucket.x);
        } else {
          deltaQ = createShortContract(breakpoints, selectedBucket.x);
        }
      } else {
        deltaQ = optionType === 'call' 
          ? createCallContract(breakpoints, selectedBucket.x)
          : createPutContract(breakpoints, selectedBucket.x);
      }

      const scaledDeltaQ = deltaQ.map(dq => {
        if (tradingMode === 'simple') {
          return dq * tradeSize;
        } else {
          return dq * tradeSize * (tradeSide === 'buy' ? 1 : -1);
        }
      });

      validateTrade(scaledDeltaQ, q, b);
      
      const C = (qvec) => {
        const maxQ = Math.max(...qvec);
        const sumExp = qvec.reduce((sum, qk) => sum + Math.exp((qk - maxQ) / b), 0);
        return b * (Math.log(sumExp) + maxQ / b);
      };
      
      const cost = C(q.map((qk, i) => qk + scaledDeltaQ[i])) - C(q);
      const pricePerContract = Math.abs(cost) / tradeSize;

      if (orderType === 'limit' && limitPrice) {
        const expectedPrice = parseFloat(limitPrice);
        const slippage = Math.abs(pricePerContract - expectedPrice) / expectedPrice;
        
        if (slippage > slippageTolerance) {
          throw new Error(`Slippage too high: ${(slippage*100).toFixed(2)}%. Max: ${(slippageTolerance*100).toFixed(2)}%`);
        }
      }

      if (orderType === 'market') {
        const user_id = localStorage.getItem('user_id') || 'demo';
        const val = selectedBucket.x;
        const dir = tradeSide;
        const n = tradeSize;
        const T = 0;
        const execute = true;
        const res = await quoteAndTrade(id, val, dir, n, T, user_id, execute);
        if (!res.success) {
          throw new Error(res.message || 'Trade failed');
        }
        setTradeResult({
          success: true,
          message: res.message || `${tradeSide === 'buy' ? 'Bought' : 'Sold'} ${tradeSize} contracts at market`,
          details: res.details || {}
        });
        fetchMarket();
        setTrades(prev => [
          ...prev,
          {
            id: Date.now(),
            timestamp: new Date().toLocaleString(),
            side: tradeSide,
            size: tradeSize,
            price: res.details?.price || null,
            contractType: tradingMode === 'simple' ? `${tradeSide} simple` : optionType,
            strike: selectedBucket?.x,
            mode: tradingMode,
            user: user_id,
          }
        ]);
      } else {
        const user_id = localStorage.getItem('user_id') || 'demo';
        const bucket_idx = selectedBucket.idx;
        const size = tradeSize;
        const side = tradeSide;
        const order_type = orderType;
        const limit_price = orderType === 'limit' || orderType === 'stop' ? parseFloat(limitPrice) : null;
        const res = await placeMarketOrder(id, bucket_idx, side, size, order_type, limit_price);
        if (!res.success) {
          throw new Error(res.message || 'Order placement failed');
        }
        setTradeResult({
          success: true,
          message: res.message || `${orderType.charAt(0).toUpperCase() + orderType.slice(1)} order placed for ${tradeSize} contracts`
        });
        fetchMarket();
      }
    } catch (err) {
      setTradeResult({ success: false, message: err.message });
    }
  };

  const TabPanel = ({ children, value, index }) => (
    <div hidden={value !== index}>
      {value === index && <Box sx={{ p: 3 }}>{children}</Box>}
    </div>
  );

  return (
    <Box component="main" sx={{ maxWidth: 1200, mx: 'auto', mt: 2, p: 2 }}>
      {loading ? (
        <Box display="flex" justifyContent="center" alignItems="center" minHeight={300}>
          <CircularProgress />
        </Box>
      ) : error ? (
        <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>
      ) : (
        <>
          {/* Updated validation logic to handle the case where breakpoints are missing */}
          {(!market || !Array.isArray(q) || q.length === 0 || !Array.isArray(prices) || prices.length === 0) ? (
            <Alert severity="warning" sx={{ mb: 2 }}>
              Unable to display market details: Core market data is missing.
              <br />
              <span style={{ fontSize: '0.9em' }}>
                Please check backend responses. Market data requirements: market object, non-empty q array, and valid prices.
                <br />
                (market: {market ? 'loaded' : 'missing'}, q: {q?.length ?? 'n/a'}, prices: {prices?.length ?? 'n/a'})
                {!Array.isArray(breakpoints) || breakpoints.length === 0 ? (
                  <><br />Note: Breakpoints will be auto-generated from q array.</>
                ) : (
                  <><br />Breakpoints: {breakpoints?.length ?? 'n/a'}</>
                )}
              </span>
            </Alert>
          ) : (
            <>
              <Paper elevation={3} sx={{ p: 3, mb: 3 }}>
                <Typography variant="h5" gutterBottom>
                  {market?.name || 'Venture Outcome Betting Market'}
                </Typography>
                <Typography variant="body1" color="text.secondary" gutterBottom>
                  {market?.description || 'Prediction market for venture valuations and outcomes'}
                </Typography>
                
                {/* Real-time Market Stats */}
                <Grid container spacing={2} sx={{ mt: 2 }}>
                  <Grid item xs={6} md={3}>
                    <Card>
                      <CardContent>
                        <Typography variant="subtitle2" color="text.secondary">Current Valuation</Typography>
                        <Typography variant="h6">${(currentValuation/1e6).toFixed(1)}M</Typography>
                      </CardContent>
                    </Card>
                  </Grid>
                  <Grid item xs={6} md={3}>
                    <Card>
                      <CardContent>
                        <Typography variant="subtitle2" color="text.secondary">Market Probability</Typography>
                        <Typography variant="h6">{(prices.reduce((a, b) => a + b, 0) * 100).toFixed(1)}%</Typography>
                      </CardContent>
                    </Card>
                  </Grid>
                  <Grid item xs={6} md={3}>
                    <Card>
                      <CardContent>
                        <Typography variant="subtitle2" color="text.secondary">Time to Resolution</Typography>
                        <Typography variant="h6">{timeToExpiry}d</Typography>
                      </CardContent>
                    </Card>
                  </Grid>
                  <Grid item xs={6} md={3}>
                    <Card>
                      <CardContent>
                        <Typography variant="subtitle2" color="text.secondary">Liquidity Pool</Typography>
                        <Typography variant="h6">${(b/1000).toFixed(1)}K</Typography>
                      </CardContent>
                    </Card>
                  </Grid>
                </Grid>
              </Paper>

              <Tabs value={activeTab} onChange={(e, v) => setActiveTab(v)}>
                <Tab label="Trading" />
                <Tab label="Portfolio" />
                <Tab label="Analytics" />
                <Tab label="Risk Management" />
              </Tabs>

              {/* Trading Tab */}
              <TabPanel value={activeTab} index={0}>
                <Grid container spacing={3}>
                  {/* Trading Mode Toggle */}
                  <Grid item xs={12}>
                    <Box display="flex" gap={2} mb={3}>
                      <Button 
                        variant={tradingMode === 'simple' ? 'contained' : 'outlined'}
                        onClick={() => setTradingMode('simple')}
                        size="large"
                      >
                        📈 Binary Betting
                      </Button>
                      <Button 
                        variant={tradingMode === 'options' ? 'contained' : 'outlined'}
                        onClick={() => setTradingMode('options')}
                        size="large"
                      >
                        🎯 Options Contracts
                      </Button>
                    </Box>
                    
                    {tradingMode === 'simple' && (
                      <Alert severity="info" sx={{ mb: 2 }}>
                        <strong>Binary Betting:</strong> Each contract pays $1.00 if the outcome occurs, $0 otherwise. 
                        Current price reflects market probability.
                      </Alert>
                    )}
                    
                    {tradingMode === 'options' && (
                      <Alert severity="info" sx={{ mb: 2 }}>
                        <strong>Options Trading:</strong> Call = Right to buy at strike, Put = Right to sell at strike.
                        Payoff based on final valuation minus strike price.
                      </Alert>
                    )}
                  </Grid>

                  {/* Order Entry */}
                  <Grid item xs={12} md={6}>
                    <Typography variant="h6" gutterBottom>
                      {tradingMode === 'simple' ? 'Place Bet' : 'Place Option Order'}
                    </Typography>
                    
                    {/* Buy/Sell Buttons */}
                    <Box display="flex" gap={2} mb={2}>
                      <Button 
                        variant={tradeSide === 'buy' ? 'contained' : 'outlined'} 
                        color="primary"
                        onClick={() => setTradeSide('buy')}
                        fullWidth
                      >
                        {tradingMode === 'simple' ? '📈 Buy YES' : 'Buy'}
                      </Button>
                      <Button 
                        variant={tradeSide === 'sell' ? 'contained' : 'outlined'} 
                        color="secondary"
                        onClick={() => setTradeSide('sell')}
                        fullWidth
                      >
                        {tradingMode === 'simple' ? '📉 Buy NO' : 'Sell'}
                      </Button>
                    </Box>

                    {/* Option Type - Only show for options mode */}
                    {tradingMode === 'options' && (
                      <Box display="flex" gap={2} mb={2}>
                        <FormControl fullWidth size="small">
                          <InputLabel>Option Type</InputLabel>
                          <Select value={optionType} onChange={(e) => setOptionType(e.target.value)}>
                            <MenuItem value="call">Call Option</MenuItem>
                            <MenuItem value="put">Put Option</MenuItem>
                          </Select>
                        </FormControl>
                        <FormControl fullWidth size="small">
                          <InputLabel>Order Type</InputLabel>
                          <Select value={orderType} onChange={(e) => setOrderType(e.target.value)}>
                            <MenuItem value="market">Market</MenuItem>
                            <MenuItem value="limit">Limit</MenuItem>
                            <MenuItem value="stop">Stop</MenuItem>
                          </Select>
                        </FormControl>
                      </Box>
                    )}

                    {/* Order Type for Simple Mode */}
                    {tradingMode === 'simple' && (
                      <Box mb={2}>
                        <FormControl fullWidth size="small">
                          <InputLabel>Order Type</InputLabel>
                          <Select value={orderType} onChange={(e) => setOrderType(e.target.value)}>
                            <MenuItem value="market">Market</MenuItem>
                            <MenuItem value="limit">Limit</MenuItem>
                            <MenuItem value="stop">Stop</MenuItem>
                          </Select>
                        </FormControl>
                      </Box>
                    )}

                    {/* Strike and Size */}
                    <Box mb={2}>
                      <TextField
                        label={tradingMode === 'simple' ? 'Outcome Threshold (e.g., "50m", "1.2b")' : 'Strike Price (e.g., "50m", "1.2b")'}
                        value={customValuation}
                        onChange={handleValuationChange}
                        fullWidth
                        size="small"
                        sx={{ mb: 1 }}
                      />
                      <TextField
                        label="Quantity (contracts)"
                        type="number"
                        value={tradeSize}
                        onChange={(e) => setTradeSize(Number(e.target.value) || 0)}
                        fullWidth
                        size="small"
                        sx={{ mb: 1 }}
                      />
                      {(orderType === 'limit' || orderType === 'stop') && (
                        <TextField
                          label={orderType === 'limit' ? 'Limit Price ($)' : 'Stop Price ($)'}
                          type="number"
                          value={limitPrice}
                          onChange={(e) => setLimitPrice(e.target.value)}
                          fullWidth
                          size="small"
                          step="0.01"
                        />
                      )}
                    </Box>

                    {/* Trade Description */}
                    {tradeDescription && (
                      <Alert severity="info" sx={{ mb: 2 }}>
                        {tradeDescription}
                      </Alert>
                    )}

                    {/* Order Button */}
                    <Button 
                      variant="contained" 
                      color="primary" 
                      fullWidth
                      size="large"
                      onClick={handleTrade}
                      disabled={!selectedBucket || tradeSize <= 0}
                    >
                      {orderType === 'market' ? 'Execute' : 'Place'} {tradingMode === 'simple' ? 'Bet' : 'Option Order'}
                    </Button>

                    {/* Trade Result */}
                    {tradeResult && (
                      <Alert 
                        severity={tradeResult.success ? 'success' : 'error'} 
                        sx={{ mt: 2 }}
                      >
                        {tradeResult.message}
                        {tradeResult.details?.greeks && (
                          <Box sx={{ mt: 1, fontSize: '0.875rem' }}>
                            <strong>Greeks:</strong> δ={tradeResult.details.greeks.delta.toFixed(3)}, 
                            γ={tradeResult.details.greeks.gamma.toFixed(3)}, 
                            θ={tradeResult.details.greeks.theta.toFixed(3)}
                          </Box>
                        )}
                      </Alert>
                    )}
                  </Grid>

                  {/* Market Data */}
                  <Grid item xs={12} md={6}>
                    <Typography variant="h6" gutterBottom>
                      {tradingMode === 'simple' ? 'Outcome Probabilities' : 'Options Chain'}
                    </Typography>
                    <Box sx={{ height: 400, overflow: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                        <thead>
                          <tr style={{ backgroundColor: '#f5f5f5' }}>
                            <th style={{ padding: '8px', textAlign: 'left' }}>
                              {tradingMode === 'simple' ? 'Threshold' : 'Strike'}
                            </th>
                            <th style={{ padding: '8px', textAlign: 'center' }}>Bid</th>
                            <th style={{ padding: '8px', textAlign: 'center' }}>Ask</th>
                            {tradingMode === 'options' && (
                              <>
                                <th style={{ padding: '8px', textAlign: 'center' }}>Delta</th>
                                <th style={{ padding: '8px', textAlign: 'right' }}>BS Price</th>
                              </>
                            )}
                            {tradingMode === 'simple' && (
                              <th style={{ padding: '8px', textAlign: 'right' }}>Probability</th>
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {bidAskRows.map((row, idx) => (
                            <tr key={idx} style={{ borderBottom: '1px solid #eee' }}>
                              <td style={{ padding: '8px' }}>${(row.value/1e6).toFixed(1)}M</td>
                              <td style={{ padding: '8px', textAlign: 'center', color: 'green' }}>
                                {row.bid.toFixed(3)}
                              </td>
                              <td style={{ padding: '8px', textAlign: 'center', color: 'red' }}>
                                {row.ask.toFixed(3)}
                              </td>
                              {tradingMode === 'options' && (
                                <>
                                  <td style={{ padding: '8px', textAlign: 'center' }}>
                                    {row.greeks.delta.toFixed(3)}
                                  </td>
                                  <td style={{ padding: '8px', textAlign: 'right' }}>
                                    ${row.blackScholesPrice.toFixed(3)}
                                  </td>
                                </>
                              )}
                              {tradingMode === 'simple' && (
                                <td style={{ padding: '8px', textAlign: 'right' }}>
                                  {(row.mid * 100).toFixed(2)}%
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </Box>
                  </Grid>

                  {/* Trade Log */}
                  <Grid item xs={12}>
                    <Typography variant="h6" gutterBottom>Recent Trades</Typography>
                    <Box sx={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ backgroundColor: '#f5f5f5' }}>
                            <th style={{ padding: '6px' }}>Timestamp</th>
                            <th style={{ padding: '6px' }}>Side</th>
                            <th style={{ padding: '6px' }}>Size</th>
                            <th style={{ padding: '6px' }}>Price</th>
                            <th style={{ padding: '6px' }}>Type</th>
                            <th style={{ padding: '6px' }}>Strike</th>
                            <th style={{ padding: '6px' }}>Mode</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(Array.isArray(trades) ? trades : []).map(trade => (
                            <tr key={trade.id || trade.timestamp || Math.random()}>
                              <td style={{ padding: '6px' }}>{trade.timestamp || ''}</td>
                              <td style={{ padding: '6px' }}>{trade.side || ''}</td>
                              <td style={{ padding: '6px' }}>{trade.size || ''}</td>
                              <td style={{ padding: '6px' }}>{trade.price != null ? Number(trade.price).toFixed(4) : ''}</td>
                              <td style={{ padding: '6px' }}>{trade.contractType || ''}</td>
                              <td style={{ padding: '6px' }}>{trade.strike ? trade.strike.toLocaleString() : ''}</td>
                              <td style={{ padding: '6px' }}>{trade.mode || ''}</td>
                            </tr>
                          ))}
                          {(!Array.isArray(trades) || trades.length === 0) && (
                            <tr><td colSpan={7} style={{ padding: '6px', textAlign: 'center', color: '#888' }}>No trades yet</td></tr>
                          )}
                        </tbody>
                      </table>
                    </Box>
                  </Grid>
                </Grid>
              </TabPanel>

              {/* Portfolio Tab */}
              <TabPanel value={activeTab} index={1}>
                <Grid container spacing={3}>
                  <Grid item xs={12}>
                    <Typography variant="h6" gutterBottom>Portfolio Summary</Typography>
                    <Grid container spacing={2}>
                      <Grid item xs={6} md={2}>
                        <Card>
                          <CardContent>
                            <Typography variant="subtitle2" color="text.secondary">Total Value</Typography>
                            <Typography variant="h6">${portfolioMetrics.totalValue.toFixed(2)}</Typography>
                          </CardContent>
                        </Card>
                      </Grid>
                      <Grid item xs={6} md={2}>
                        <Card>
                          <CardContent>
                            <Typography variant="subtitle2" color="text.secondary">Delta</Typography>
                            <Typography variant="h6">{portfolioMetrics.delta.toFixed(3)}</Typography>
                          </CardContent>
                        </Card>
                      </Grid>
                      <Grid item xs={6} md={2}>
                        <Card>
                          <CardContent>
                            <Typography variant="subtitle2" color="text.secondary">Gamma</Typography>
                            <Typography variant="h6">{portfolioMetrics.gamma.toFixed(3)}</Typography>
                          </CardContent>
                        </Card>
                      </Grid>
                      <Grid item xs={6} md={2}>
                        <Card>
                          <CardContent>
                            <Typography variant="subtitle2" color="text.secondary">Theta</Typography>
                            <Typography variant="h6">{portfolioMetrics.theta.toFixed(3)}</Typography>
                          </CardContent>
                        </Card>
                      </Grid>
                      <Grid item xs={6} md={2}>
                        <Card>
                          <CardContent>
                            <Typography variant="subtitle2" color="text.secondary">Vega</Typography>
                            <Typography variant="h6">{portfolioMetrics.vega.toFixed(3)}</Typography>
                          </CardContent>
                        </Card>
                      </Grid>
                      <Grid item xs={6} md={2}>
                        <Card>
                          <CardContent>
                            <Typography variant="subtitle2" color="text.secondary">Positions</Typography>
                            <Typography variant="h6">{portfolio.length}</Typography>
                          </CardContent>
                        </Card>
                      </Grid>
                    </Grid>
                  </Grid>

                  {/* Individual Positions */}
                  <Grid item xs={12}>
                    <Typography variant="h6" gutterBottom>Open Positions</Typography>
                    {portfolio.length === 0 ? (
                      <Typography color="text.secondary">No open positions</Typography>
                    ) : (
                      <Box sx={{ overflow: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <thead>
                            <tr style={{ backgroundColor: '#f5f5f5' }}>
                              <th style={{ padding: '8px' }}>Time</th>
                              <th style={{ padding: '8px' }}>Type</th>
                              <th style={{ padding: '8px' }}>Strike</th>
                              <th style={{ padding: '8px' }}>Qty</th>
                              <th style={{ padding: '8px' }}>Entry</th>
                              <th style={{ padding: '8px' }}>Current</th>
                              <th style={{ padding: '8px' }}>P&L</th>
                              <th style={{ padding: '8px' }}>Greeks</th>
                              <th style={{ padding: '8px' }}>Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {portfolio.map((position) => {
                              const currentPrice = bidAskRows.find(row => row.value === position.strike)?.mid || 0;
                              const pnl = (currentPrice - position.entryPrice) * position.quantity;
                              const pnlPercent = position.entryPrice > 0 ? (pnl / (position.entryPrice * Math.abs(position.quantity))) * 100 : 0;
                              
                              return (
                                <tr key={position.id}>
                                  <td style={{ padding: '8px' }}>{position.timestamp?.toLocaleTimeString()}</td>
                                  <td style={{ padding: '8px' }}>
                                    <Chip label={position.optionType} size="small" />
                                  </td>
                                  <td style={{ padding: '8px' }}>${(position.strike/1e6).toFixed(1)}M</td>
                                  <td style={{ padding: '8px', color: position.quantity > 0 ? 'green' : 'red' }}>
                                    {position.quantity > 0 ? '+' : ''}{position.quantity}
                                  </td>
                                  <td style={{ padding: '8px' }}>${position.entryPrice?.toFixed(3)}</td>
                                  <td style={{ padding: '8px' }}>${currentPrice.toFixed(3)}</td>
                                  <td style={{ padding: '8px', color: pnl >= 0 ? 'green' : 'red' }}>
                                    ${pnl.toFixed(2)} ({pnlPercent.toFixed(1)}%)
                                  </td>
                                  <td style={{ padding: '8px', fontSize: '0.75rem' }}>
                                    δ:{position.greeks?.delta?.toFixed(2)}<br/>
                                    γ:{position.greeks?.gamma?.toFixed(2)}
                                  </td>
                                  <td style={{ padding: '8px' }}>
                                    <Button 
                                      size="small" 
                                      color="warning"
                                      onClick={() => closePosition(position.id)}
                                    >
                                      Close
                                    </Button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </Box>
                    )}
                  </Grid>
                </Grid>
              </TabPanel>

              {/* Analytics Tab */}
              <TabPanel value={activeTab} index={2}>
                <Grid container spacing={3}>
                  {/* Probability Distribution Chart */}
                  <Grid item xs={12} md={8}>
                    <Typography variant="h6" gutterBottom>Valuation Probability Distribution</Typography>
                    <Box sx={{ height: 400 }}>
                      <Line 
                        data={distributionData} 
                        options={{
                          responsive: true,
                          maintainAspectRatio: false,
                          plugins: { 
                            legend: { display: false },
                            title: { display: true, text: 'Market-Implied Venture Outcome Probabilities' }
                          },
                          scales: {
                            x: { title: { display: true, text: 'Valuation (USD)' } },
                            y: { title: { display: true, text: 'Probability (%)' } },
                          },
                        }} 
                      />
                    </Box>
                  </Grid>

                  {/* Market Parameters */}
                  <Grid item xs={12} md={4}>
                    <Typography variant="h6" gutterBottom>Market Parameters</Typography>
                    <Box display="flex" flexDirection="column" gap={2}>
                      <TextField
                        label="Current Valuation ($M)"
                        type="number"
                        value={currentValuation / 1e6}
                        onChange={(e) => setCurrentValuation(Number(e.target.value) * 1e6)}
                        size="small"
                      />
                      <TextField
                        label="Implied Volatility"
                        type="number"
                        value={impliedVolatility}
                        onChange={(e) => setImpliedVolatility(Number(e.target.value))}
                        size="small"
                        inputProps={{ min: 0.01, max: 2, step: 0.01 }}
                      />
                      <TextField
                        label="Time to Resolution (days)"
                        type="number"
                        value={timeToExpiry}
                        onChange={(e) => setTimeToExpiry(Number(e.target.value))}
                        size="small"
                      />
                      <TextField
                        label="Risk-Free Rate"
                        type="number"
                        value={riskFreeRate}
                        onChange={(e) => setRiskFreeRate(Number(e.target.value))}
                        size="small"
                        inputProps={{ min: 0, max: 0.2, step: 0.001 }}
                      />
                      <TextField
                        label="AMM Liquidity Parameter"
                        type="number"
                        value={b}
                        onChange={(e) => setB(Number(e.target.value))}
                        size="small"
                      />
                    </Box>
                  </Grid>

                  {/* Startup Initialization Section */}
                  <Grid item xs={12}>
                    <Typography variant="h6" gutterBottom>Startup Market Initialization</Typography>
                    <Box display="flex" gap={2} alignItems="center" flexWrap="wrap" mb={2}>
                      <TextField
                        label="Company Name"
                        value={market?.companyName || ''}
                        onChange={(e) => setMarket(prev => ({ ...prev, companyName: e.target.value }))}
                        size="small"
                        sx={{ width: 200 }}
                      />
                      <FormControl size="small" sx={{ width: 120 }}>
                        <InputLabel>Stage</InputLabel>
                        <Select 
                          value={market?.stage || 'growth'} 
                          onChange={(e) => {
                            setMarket(prev => ({ ...prev, stage: e.target.value }));
                            // Auto-update probabilities based on stage
                            const stage = e.target.value;
                            let workingBreakpoints = breakpoints;
                            if (!workingBreakpoints || workingBreakpoints.length === 0) {
                              workingBreakpoints = createRealisticStartupBreakpoints(1e6, 500e9);
                            }
                            const realisticProbs = createRealisticStartupProbabilities(workingBreakpoints, currentValuation, stage);
                            const newQ = createStartupQLMSR(realisticProbs, b);
                            setQ(newQ);
                            setBreakpoints(workingBreakpoints);
                          }}
                        >
                          <MenuItem value="seed">Seed</MenuItem>
                          <MenuItem value="seriesA">Series A</MenuItem>
                          <MenuItem value="growth">Growth</MenuItem>
                          <MenuItem value="late">Late Stage</MenuItem>
                          <MenuItem value="mega">Mega Scale</MenuItem>
                        </Select>
                      </FormControl>
                      <Button
                        variant="outlined"
                        onClick={() => {
                          // Initialize with realistic probabilities
                          const stage = market?.stage || 'growth';
                          let workingBreakpoints = breakpoints;
                          if (!workingBreakpoints || workingBreakpoints.length === 0) {
                            workingBreakpoints = createRealisticStartupBreakpoints(1e6, 500e9);
                          }
                          const realisticProbs = createRealisticStartupProbabilities(workingBreakpoints, currentValuation, stage);
                          const newQ = createStartupQLMSR(realisticProbs, b);
                          setQ(newQ);
                          setBreakpoints(workingBreakpoints);
                        }}
                      >
                        🎯 Smart Initialize
                      </Button>
                      <Button
                        variant="outlined"
                        color="info"
                        onClick={async () => {
                          // Note: In a real implementation, you could use free APIs like:
                          // - Perplexity API (free tier)
                          // - OpenAI GPT-3.5 (affordable)
                          // - Local models via Ollama
                          // - SerpAPI for Google searches
                          alert(`🔍 Valuation Research Feature\n\nTo implement this, consider:\n\n1. Perplexity AI API (free tier) - excellent for recent data\n2. SerpAPI + OpenAI GPT-3.5 - search + analysis\n3. Local Ollama model + DuckDuckGo API\n4. Manual research links:\n   - Crunchbase\n   - PitchBook\n   - TechCrunch funding announcements\n   - Company press releases\n\nFor now, you can manually enter the last known valuation.`);
                        }}
                      >
                        🔍 Research Valuation
                      </Button>
                    </Box>
                    <Alert severity="info" sx={{ mb: 2 }}>
                      <strong>Smart Initialization:</strong> Creates realistic probability distributions based on startup stage, 
                      with log-normal distributions centered around current valuation, accounting for survival bias and down-round risks.
                    </Alert>
                  </Grid>
                  {/* Bayesian Updates */}
                  <Grid item xs={12}>
                    <Typography variant="h6" gutterBottom>Bayesian Evidence Update</Typography>
                    <Box display="flex" gap={2} alignItems="center" flexWrap="wrap">
                      <TextField
                        label="Confidence (0-1)"
                        type="number"
                        value={bayesConf}
                        onChange={(e) => setBayesConf(Number(e.target.value))}
                        size="small"
                        inputProps={{ min: 0, max: 1, step: 0.01 }}
                        sx={{ width: 120 }}
                      />
                      <TextField
                        label="Threshold ($M)"
                        type="number"
                        value={bayesThresh / 1e6}
                        onChange={(e) => setBayesThresh(Number(e.target.value) * 1e6)}
                        size="small"
                        sx={{ width: 120 }}
                      />
                      <TextField
                        label="Boost Factor"
                        type="number"
                        value={bayesBoost}
                        onChange={(e) => setBayesBoost(Number(e.target.value))}
                        size="small"
                        inputProps={{ min: 1, max: 10, step: 0.1 }}
                        sx={{ width: 120 }}
                      />
                      <Button
                        variant="contained"
                        color="secondary"
                        onClick={handleBayesianUpdate}
                        disabled={bayesConf <= 0 || bayesConf > 1 || !bayesThresh || bayesBoost <= 1}
                      >
                        Apply Update
                      </Button>
                    </Box>
                    <Typography variant="caption" display="block" sx={{ mt: 1 }}>
                      Example: "95% confident funding raised at $40M+" → Confidence: 0.95, Threshold: 40, Boost: 3
                    </Typography>
                  </Grid>
                </Grid>
              </TabPanel>

              {/* Risk Management Tab */}
              <TabPanel value={activeTab} index={3}>
                <Grid container spacing={3}>
                  {/* Risk Settings */}
                  <Grid item xs={12} md={6}>
                    <Typography variant="h6" gutterBottom>Risk Controls</Typography>
                    <Box display="flex" flexDirection="column" gap={2}>
                      <TextField
                        label="Max Position Size"
                        type="number"
                        value={maxPosition}
                        onChange={(e) => setMaxPosition(Number(e.target.value))}
                        size="small"
                      />
                      <TextField
                        label="Slippage Tolerance (%)"
                        type="number"
                        value={slippageTolerance * 100}
                        onChange={(e) => setSlippageTolerance(Number(e.target.value) / 100)}
                        size="small"
                        inputProps={{ min: 0.1, max: 10, step: 0.1 }}
                      />
                      <FormControlLabel
                        control={
                          <Switch
                            checked={marketMakingEnabled}
                            onChange={(e) => setMarketMakingEnabled(e.target.checked)}
                          />
                        }
                        label="Market Making Mode"
                      />
                      {marketMakingEnabled && (
                        <TextField
                          label="Market Maker Spread (%)"
                          type="number"
                          value={marketMakerSpread * 100}
                          onChange={(e) => setMarketMakerSpread(Number(e.target.value) / 100)}
                          size="small"
                          inputProps={{ min: 0.1, max: 5, step: 0.1 }}
                        />
                      )}
                    </Box>
                  </Grid>

                  {/* Position Limits */}
                  <Grid item xs={12} md={6}>
                    <Typography variant="h6" gutterBottom>Position Exposure</Typography>
                    <Box>
                      {Object.entries(userPositions).map(([strike, position]) => (
                        <Box key={strike} display="flex" justifyContent="space-between" py={1}>
                          <Typography>${(Number(strike)/1e6).toFixed(1)}M:</Typography>
                          <Typography 
                            color={Math.abs(position) > maxPosition * 0.8 ? 'warning.main' : 'text.primary'}
                          >
                            {position} / {maxPosition}
                          </Typography>
                        </Box>
                      ))}
                      {(!userPositions || Object.keys(userPositions).length === 0) && (
                        <Typography color="text.secondary">No positions</Typography>
                      )}
                    </Box>
                  </Grid>

                  {/* Trade History */}
                  <Grid item xs={12}>
                    <Typography variant="h6" gutterBottom>Recent Trade History</Typography>
                    <Box sx={{ maxHeight: 300, overflow: 'auto' }}>
                      {(Array.isArray(trades) ? trades : []).length === 0 ? (
                        <Typography color="text.secondary">No trades yet</Typography>
                      ) : (
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <thead>
                            <tr style={{ backgroundColor: '#f5f5f5' }}>
                              <th style={{ padding: '8px' }}>Time</th>
                              <th style={{ padding: '8px' }}>Type</th>
                              <th style={{ padding: '8px' }}>Strike</th>
                              <th style={{ padding: '8px' }}>Side</th>
                              <th style={{ padding: '8px' }}>Qty</th>
                              <th style={{ padding: '8px' }}>Price</th>
                              <th style={{ padding: '8px' }}>Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(Array.isArray(trades) ? trades : []).slice(-20).reverse().map((trade, idx) => (
                              <tr key={idx}>
                                <td style={{ padding: '8px' }}>{trade.time}</td>
                                <td style={{ padding: '8px' }}>{trade.optionType || 'binary'}</td>
                                <td style={{ padding: '8px' }}>{trade.strike}</td>
                                <td style={{ padding: '8px', color: trade.side === 'buy' ? 'green' : 'red' }}>
                                  {trade.side}
                                </td>
                                <td style={{ padding: '8px' }}>{trade.size}</td>
                                <td style={{ padding: '8px' }}>{trade.price || 'N/A'}</td>
                                <td style={{ padding: '8px' }}>{trade.total || 'N/A'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </Box>
                  </Grid>
                </Grid>
              </TabPanel>
            </>
          )}
        </>
      )}
      
      {/* Pending Orders Section */}
      {pendingOrders.length > 0 && (
        <Box mt={3}>
          <Paper elevation={2} sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>Pending Orders</Typography>
            <Box sx={{ overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f5f5f5' }}>
                    <th style={{ padding: '8px' }}>Time</th>
                    <th style={{ padding: '8px' }}>Type</th>
                    <th style={{ padding: '8px' }}>Strike</th>
                    <th style={{ padding: '8px' }}>Side</th>
                    <th style={{ padding: '8px' }}>Qty</th>
                    <th style={{ padding: '8px' }}>Price</th>
                    <th style={{ padding: '8px' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingOrders.map((order) => (
                    <tr key={order.id}>
                      <td style={{ padding: '8px' }}>{order.timestamp?.toLocaleTimeString()}</td>
                      <td style={{ padding: '8px' }}>
                        <Chip label={order.optionType || 'binary'} size="small" />
                      </td>
                      <td style={{ padding: '8px' }}>${(order.strike/1e6).toFixed(1)}M</td>
                      <td style={{ padding: '8px' }}>
                        <Chip 
                          label={order.side} 
                          size="small" 
                          color={order.side === 'buy' ? 'primary' : 'secondary'} 
                        />
                      </td>
                      <td style={{ padding: '8px' }}>{order.quantity}</td>
                      <td style={{ padding: '8px' }}>
                        {order.limitPrice ? `${order.limitPrice.toFixed(3)}` : 'Market'}
                      </td>
                      <td style={{ padding: '8px' }}>
                        <Button 
                          size="small" 
                          color="error"
                          onClick={() => cancelOrder(order.id)}
                        >
                          Cancel
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Box>
          </Paper>
        </Box>
      )}

      {/* Market Summary Footer */}
      <Box mt={3}>
        <Paper elevation={1} sx={{ p: 2, bgcolor: '#f8f9fa' }}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} md={3}>
              <Typography variant="body2" color="text.secondary">Market Summary</Typography>
              <Typography variant="h6">
                Total Probability: {(prices.reduce((a, b) => a + b, 0) * 100).toFixed(1)}%
              </Typography>
            </Grid>
            <Grid item xs={12} md={3}>
              <Typography variant="body2" color="text.secondary">Market Maker Cost</Typography>
              <Typography variant="h6">
                ${(b * Math.log(q.length)).toFixed(0)}
              </Typography>
            </Grid>
            <Grid item xs={12} md={3}>
              <Typography variant="body2" color="text.secondary">Active Trades</Typography>
              <Typography variant="h6">
                {trades.length} total
              </Typography>
            </Grid>
            <Grid item xs={12} md={3}>
              <Typography variant="body2" color="text.secondary">Your Portfolio</Typography>
              <Typography variant="h6" color={portfolioMetrics.totalValue >= 0 ? 'success.main' : 'error.main'}>
                ${portfolioMetrics.totalValue.toFixed(2)}
              </Typography>
            </Grid>
          </Grid>
        </Paper>
      </Box>

      {error && (
        <Box mt={4}>
          <Alert severity="error">{error}</Alert>
        </Box>
      )}
    </Box>
  );
}

export default MarketDetail;