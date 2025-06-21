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
    try {
      const formData = new URLSearchParams();
      formData.append('username', username);
      formData.append('password', password);
      
      const response = await fetch('http://127.0.0.1:8000/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Login failed');
      }

      const data = await response.json();
      localStorage.setItem('token', data.access_token);
      setToken(data.access_token);
      
      // Fetch user data
      const userResponse = await fetch('http://127.0.0.1:8000/users/me', {
        headers: { 'Authorization': `Bearer ${data.access_token}` }
      });
      const userData = await userResponse.json();
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
