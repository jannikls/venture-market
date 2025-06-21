import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token') || '');
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const logout = useCallback(() => {
    setUser(null);
    setToken('');
    localStorage.removeItem('token');
    navigate('/login');
  }, [navigate]);

  // Check if user is logged in on initial load
  useEffect(() => {
    const checkAuth = async () => {
      if (token) {
        try {
          const response = await fetch('http://127.0.0.1:8000/users/me', {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (response.ok) {
            const userData = await response.json();
            setUser(userData);
          } else {
            logout();
          }
        } catch (error) {
          console.error('Auth check failed:', error);
          logout();
        }
      }
      setLoading(false);
    };
    checkAuth();
  }, [token, logout]);

  const login = async (username, password) => {
    console.log('Attempting login with username:', username);
    try {
      const formData = new URLSearchParams();
      formData.append('username', username);
      formData.append('password', password);
      
      console.log('Sending login request to /token endpoint');
      const tokenUrl = 'http://127.0.0.1:8000/token';
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData,
      });

      const responseText = await response.text();
      console.log('Login response status:', response.status);
      console.log('Login response text:', responseText);

      if (!response.ok) {
        throw new Error(`Login failed: ${response.status} ${response.statusText}`);
      }

      let data;
      try {
        data = JSON.parse(responseText);
        console.log('Login successful, token received');
      } catch (e) {
        console.error('Failed to parse login response:', e);
        throw new Error('Invalid response from server');
      }

      localStorage.setItem('token', data.access_token);
      setToken(data.access_token);
      
      // Fetch user data
      console.log('Fetching user data...');
      const userResponse = await fetch('http://127.0.0.1:8000/users/me', {
        headers: { 'Authorization': `Bearer ${data.access_token}` }
      });
      
      if (!userResponse.ok) {
        console.error('Failed to fetch user data:', userResponse.status);
        throw new Error('Failed to load user data');
      }
      
      const userData = await userResponse.json();
      console.log('User data loaded:', userData);
      setUser(userData);
      
      return { success: true };
    } catch (error) {
      console.error('Login error:', error);
      return { success: false, error: 'Invalid username or password' };
    }
  };

  const register = async (username, password, email, displayName) => {
    try {
      const response = await fetch('http://127.0.0.1:8000/users/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          password,
          email,
          display_name: displayName || username,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Registration failed');
      }

      // Auto-login after registration
      return await login(username, password);
    } catch (error) {
      console.error('Registration error:', error);
      return { success: false, error: error.message };
    }
  };



  const value = {
    user,
    token,
    loading,
    login,
    register,
    logout,
    isAuthenticated: !!token,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export default AuthContext;
