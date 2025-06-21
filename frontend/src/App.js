import React, { useState } from 'react';
import { 
  Container, Typography, Box, AppBar, Toolbar, IconButton, Avatar, 
  Menu, MenuItem as MuiMenuItem, Snackbar, Alert, Button
} from '@mui/material';
import { useAuth } from './contexts/AuthContext';
import { Routes, Route, Link as RouterLink, useNavigate, Navigate } from 'react-router-dom';
import LoginForm from './components/auth/LoginForm';
import RegisterForm from './components/auth/RegisterForm';
import ProtectedRoute from './components/auth/ProtectedRoute';
import MarketList from './components/market/MarketList';
import CreateMarketForm from './components/market/CreateMarketForm';
import MarketDetail from './components/market/MarketDetail';

// Chart.js registration for react-chartjs-2 (if not already in index.js or elsewhere)
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  LogarithmicScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { getWalletBalance, faucet } from './utils/api';

// Register Chart.js components (must be after all imports)
ChartJS.register(
  CategoryScale,
  LinearScale,
  LogarithmicScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

function App() {
  // Global app state
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });
  const { user, logout } = useAuth();
  const [anchorEl, setAnchorEl] = useState(null);
  const navigate = useNavigate();
  const [balance, setBalance] = useState(null);
  const [faucetLoading, setFaucetLoading] = useState(false);

  const showSnackbar = (message, severity = 'info') => {
    setSnackbar({ open: true, message, severity });
  };

  // Fetch wallet balance when user logs in
  React.useEffect(() => {
    const fetchBalance = async () => {
      if (user && user.id) {
        try {
          const res = await getWalletBalance(user.id);
          setBalance(res.balance);
        } catch (e) {
          setBalance(null);
        }
      } else {
        setBalance(null);
      }
    };
    fetchBalance();
  }, [user]);

  const handleFaucet = async () => {
    if (!user || !user.id) return;
    setFaucetLoading(true);
    try {
      const res = await faucet(user.id, 500);
      showSnackbar(`Faucet: +${res.credited} play-money`, 'success');
      // Refresh balance
      const bal = await getWalletBalance(user.id);
      setBalance(bal.balance);
    } catch (e) {
      showSnackbar(e.message || 'Faucet error', 'error');
    } finally {
      setFaucetLoading(false);
    }
  };

  const handleCloseSnackbar = () => {
    setSnackbar(prev => ({ ...prev, open: false }));
  };

  const handleMenu = (event) => setAnchorEl(event.currentTarget);
  const handleClose = () => setAnchorEl(null);
  
  const handleLogout = () => { 
    handleClose(); 
    logout(); 
    navigate('/');
    showSnackbar('Successfully logged out', 'success');
  };
  
  const handleProfile = () => { 
    handleClose(); 
    navigate('/profile'); 
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            <RouterLink to="/" style={{ textDecoration: 'none', color: 'white' }}>
              Venture Prediction Market
            </RouterLink>
          </Typography>
          {user ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', mr: 2 }}>
                <Typography variant="body2" sx={{ color: 'white', mr: 1 }}>
                  Balance: <b>${balance !== null ? balance.toFixed(2) : '—'}</b>
                </Typography>
                <Button
                  color="secondary"
                  size="small"
                  variant="contained"
                  sx={{ minWidth: 0, px: 1, py: 0.5 }}
                  onClick={handleFaucet}
                  disabled={faucetLoading}
                >
                  Faucet
                </Button>
              </Box>
              <IconButton
                size="large"
                aria-label="account of current user"
                aria-controls="menu-appbar"
                aria-haspopup="true"
                onClick={handleMenu}
                color="inherit"
              >
                <Avatar sx={{ width: 32, height: 32 }}>
                  {user.email ? user.email.charAt(0).toUpperCase() : user.username?.charAt(0).toUpperCase() || 'U'}
                </Avatar>
              </IconButton>
              <Menu
                id="menu-appbar"
                anchorEl={anchorEl}
                anchorOrigin={{
                  vertical: 'bottom',
                  horizontal: 'right',
                }}
                keepMounted
                transformOrigin={{
                  vertical: 'top',
                  horizontal: 'right',
                }}
                open={Boolean(anchorEl)}
                onClose={handleClose}
              >
                <MuiMenuItem onClick={handleProfile}>Profile</MuiMenuItem>
                <MuiMenuItem onClick={handleLogout}>Logout</MuiMenuItem>
              </Menu>
            </div>
          ) : (
            <Button color="inherit" component={RouterLink} to="/login">
              Login
            </Button>
          )}
        </Toolbar>
      </AppBar>

      <Container component="main" sx={{ flex: 1, py: 4 }}>
        <Routes>
          <Route path="/" element={<MarketList />} />
          <Route path="/login" element={<LoginForm onLoginSuccess={() => navigate('/')} />} />
          <Route path="/register" element={<RegisterForm onRegisterSuccess={() => navigate('/login')} />} />
          <Route
            path="/create-market"
            element={
              <ProtectedRoute>
                <CreateMarketForm onMarketCreated={() => navigate('/')} />
              </ProtectedRoute>
            }
          />
          <Route path="/markets/:id" element={<MarketDetail />} />
          <Route path="/profile" element={<div>User Profile</div>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Container>

      <Box component="footer" sx={{ py: 3, px: 2, mt: 'auto', backgroundColor: (theme) => theme.palette.grey[200] }}>
        <Container maxWidth="sm">
          <Typography variant="body2" color="text.secondary" align="center">
            © {new Date().getFullYear()} Venture Prediction Market
          </Typography>
        </Container>
      </Box>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={handleCloseSnackbar}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={handleCloseSnackbar} severity={snackbar.severity} sx={{ width: '100%' }}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}

export default App;
