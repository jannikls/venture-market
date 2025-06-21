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
