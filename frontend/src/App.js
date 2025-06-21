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
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

function App() {
  // Global app state
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });
  const { user, logout } = useAuth();
  const [anchorEl, setAnchorEl] = useState(null);
  const navigate = useNavigate();

  const showSnackbar = (message, severity = 'info') => {
    setSnackbar({ open: true, message, severity });
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
            <div>
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
