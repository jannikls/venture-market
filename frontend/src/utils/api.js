const API_BASE_URL = 'http://127.0.0.1:8000';

export const fetchWithAuth = async (url, options = {}) => {
  const token = localStorage.getItem('token');
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${url}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Request failed');
  }

  return response.json();
};

export const createMarket = async (marketData) => {
  return fetchWithAuth('/markets/', {
    method: 'POST',
    body: JSON.stringify(marketData),
  });
};

export const getMarkets = async () => {
  return fetchWithAuth('/markets/');
};

export const getMarketDetail = async (id) => {
  return fetchWithAuth(`/markets/${id}`);
};

export const quoteAndTrade = async (id, val, dir, n, T, user_id, execute = false) => {
  return fetchWithAuth(`/markets/${id}/quote_and_trade`, {
    method: 'POST',
    body: JSON.stringify({ val, dir, n, T, user_id, execute }),
  });
};

export const getWalletBalance = async (user_id) => {
  return fetchWithAuth(`/wallet/balance?user_id=${user_id}`);
};

export const faucet = async (user_id, amt) => {
  return fetchWithAuth(`/faucet?user_id=${user_id}&amt=${amt}`);
};

export const depositIntent = async (user_id) => {
  return fetchWithAuth(`/depositIntent`, {
    method: 'POST',
    body: JSON.stringify({ user_id }),
  });
};

export const withdraw = async (user_id, amt) => {
  return fetchWithAuth(`/withdraw`, {
    method: 'POST',
    body: JSON.stringify({ user_id, amt }),
  });
};

export const getMarketBidAsk = async (id) => {
  return fetchWithAuth(`/markets/${id}/bid_ask`);
};

export const getMarketAMMState = async (id) => {
  return fetchWithAuth(`/markets/${id}/amm_state`);
};

export const placeMarketOrder = async (id, bucket_idx, side, size, order_type, limit_price = null) => {
  return fetchWithAuth(`/markets/${id}/order`, {
    method: 'POST',
    body: JSON.stringify({ bucket_idx, side, size, order_type, limit_price }),
  });
};
